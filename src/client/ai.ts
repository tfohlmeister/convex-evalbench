import type { Evalbench, RunActionCtx } from "./index.js";

/**
 * `evalbenchMiddleware` adapter: one optional ingestion source that wraps a
 * Vercel AI SDK model as `LanguageModelV2Middleware` (AI SDK v6, provider
 * spec `v3`) so each model call it makes is recorded as an `llm` span via
 * the tracing ingestion API.
 *
 * The tracing core does not depend on this module, and this module does
 * not import a value from `ai`: the AI SDK types the adapter touches are
 * described structurally (only the fields it reads), so the core builds
 * and tests without the optional `ai` peer installed. A host passes its
 * real model to `wrapLanguageModel`; structural typing keeps that
 * type-safe (see the example app for a compile-time check against the real
 * `ai` types).
 *
 * Mechanism (see design.md D1-D6):
 * - The middleware *wraps* the model call (`wrapGenerate` / `wrapStream`),
 *   so `latencyMs` is measured from real call start to end. This is
 *   strictly better than the agent adapter, whose `usageHandler` is a
 *   post-response hook with no call-start time.
 * - The Convex `ctx` is bound at construction (the AI SDK runs inside a
 *   host action). One middleware instance corresponds to one operation and
 *   carries one `traceId`; calls it wraps record sibling `llm` spans under
 *   that trace. A caller may override `traceId` / `parentSpanId` / `runId`
 *   for correlation (for example an eval-run target).
 * - Raw prompt/response content is recorded only when `recordContent` is
 *   set, delegating inline-versus-File-Storage handling to the ingestion
 *   API.
 */

/** Structural subset of AI SDK v6 (`LanguageModelV3`) usage. */
interface AiUsage {
  inputTokens?: { total?: number | null } | null;
  outputTokens?: { total?: number | null } | null;
}

/** A content part of a generate result; text parts carry `text`. */
interface AiContentPart {
  type: string;
  text?: string;
}

/**
 * Structural subset of the AI SDK v3 finish reason. It is an object (not a
 * string): `unified` is the normalized reason, `error` marks a failed call.
 */
interface AiFinishReason {
  unified?: string;
  raw?: string | null;
}

/** Structural subset of a `doGenerate` result. */
interface AiGenerateResult {
  content?: AiContentPart[];
  finishReason?: AiFinishReason | null;
  usage?: AiUsage | null;
  providerMetadata?: unknown;
}

/** Structural subset of a stream part (`text-delta` / `finish` / `error`). */
interface AiStreamPart {
  type: string;
  delta?: string;
  usage?: AiUsage | null;
  finishReason?: AiFinishReason | null;
  providerMetadata?: unknown;
  error?: unknown;
}

/** Structural subset of a `doStream` result. */
interface AiStreamResult {
  stream: ReadableStream<AiStreamPart>;
}

/** Structural subset of the wrapped model (`modelId` / `provider`). */
interface AiModel {
  modelId?: string;
  provider?: string;
}

/** Structural subset of the call options (`prompt` is the input). */
interface AiCallOptions {
  prompt?: unknown;
}

interface WrapGenerateArgs<R extends AiGenerateResult> {
  doGenerate: () => PromiseLike<R>;
  doStream: () => PromiseLike<AiStreamResult>;
  params: AiCallOptions;
  model: AiModel;
}

interface WrapStreamArgs<R extends AiStreamResult> {
  doStream: () => PromiseLike<R>;
  doGenerate: () => PromiseLike<AiGenerateResult>;
  params: AiCallOptions;
  model: AiModel;
}

/**
 * The shape returned by `evalbenchMiddleware`. Assignable to the AI SDK's
 * `LanguageModelV2Middleware` (spec `v3`); the generic pass-through methods
 * keep the wrapped result's type intact.
 */
export interface EvalbenchMiddleware {
  specificationVersion: "v3";
  wrapGenerate: <R extends AiGenerateResult>(
    args: WrapGenerateArgs<R>,
  ) => Promise<R>;
  wrapStream: <R extends AiStreamResult>(
    args: WrapStreamArgs<R>,
  ) => Promise<R>;
}

export interface EvalbenchMiddlewareOptions {
  evalbench: Evalbench;
  /**
   * The Convex action context the AI SDK runs inside. Needed to record
   * spans; bind it where you construct the middleware (inside your action).
   */
  ctx: RunActionCtx;
  /**
   * Record raw prompt/response as span content. Default false: metadata
   * only. Delegates inline-versus-File-Storage handling to the ingestion
   * API.
   */
  recordContent?: boolean;
  /**
   * Correlate spans with an existing trace instead of the per-instance
   * `traceId`. Supply this (with `runId`) from an eval-run target so the
   * run's traces correlate.
   */
  traceId?: string;
  /** Parent span for the recorded `llm` spans (default: none, a root). */
  parentSpanId?: string;
  /** Stamp recorded spans with a run id for eval-run correlation. */
  runId?: string;
}

function safeStringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Join the text of a generate result's content parts. */
function textOf(content: AiContentPart[] | undefined): string | undefined {
  if (!content) return undefined;
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return text.length > 0 ? text : undefined;
}

/** Map AI SDK v3 nested usage onto span token fields, when present. */
function tokenFields(usage: AiUsage | null | undefined) {
  const input = usage?.inputTokens?.total;
  const output = usage?.outputTokens?.total;
  return {
    ...(typeof input === "number" ? { inputTokens: input } : {}),
    ...(typeof output === "number" ? { outputTokens: output } : {}),
    ...(typeof input === "number" && typeof output === "number"
      ? { totalTokens: input + output }
      : {}),
  };
}

/**
 * Build an AI SDK middleware that records a span per model call. Construct
 * it inside your action (so the Convex `ctx` and the model are in scope)
 * and pass it to `wrapLanguageModel`.
 *
 * ```ts
 * const model = wrapLanguageModel({
 *   model: anthropic("claude-haiku-4-5"),
 *   middleware: evalbenchMiddleware({ evalbench, ctx }),
 * });
 * ```
 */
export function evalbenchMiddleware(
  options: EvalbenchMiddlewareOptions,
): EvalbenchMiddleware {
  const { evalbench, ctx, recordContent = false } = options;
  // One trace per middleware instance; a supplied traceId overrides it.
  const traceId = options.traceId ?? crypto.randomUUID();

  async function record(span: {
    startedAt: number;
    endedAt: number;
    status: "success" | "error";
    errorType?: string;
    usage?: AiUsage | null;
    providerMetadata?: unknown;
    model: AiModel;
    input?: string;
    output?: string;
  }): Promise<void> {
    // recordSpan is best-effort: it logs and swallows its own failures, so
    // recording never breaks the wrapped call.
    await evalbench.recordSpan(ctx, {
      traceId,
      spanId: crypto.randomUUID(),
      ...(options.parentSpanId ? { parentSpanId: options.parentSpanId } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
      kind: "llm",
      operationName: "llm call",
      ...(span.model.modelId ? { model: span.model.modelId } : {}),
      ...(span.model.provider ? { provider: span.model.provider } : {}),
      ...tokenFields(span.usage),
      status: span.status,
      ...(span.errorType ? { errorType: span.errorType } : {}),
      startedAt: span.startedAt,
      endedAt: span.endedAt,
      latencyMs: span.endedAt - span.startedAt,
      ...(span.providerMetadata !== undefined
        ? { metadata: span.providerMetadata }
        : {}),
      ...(span.input !== undefined ? { input: span.input } : {}),
      ...(span.output !== undefined ? { output: span.output } : {}),
    });
  }

  const inputContent = (params: AiCallOptions) =>
    recordContent ? safeStringify(params.prompt) : undefined;

  return {
    specificationVersion: "v3",

    wrapGenerate: async ({ doGenerate, params, model }) => {
      const startedAt = Date.now();
      try {
        const result = await doGenerate();
        await record({
          startedAt,
          endedAt: Date.now(),
          status: result.finishReason?.unified === "error" ? "error" : "success",
          usage: result.usage,
          providerMetadata: result.providerMetadata,
          model,
          input: inputContent(params),
          output: recordContent ? textOf(result.content) : undefined,
        });
        return result;
      } catch (err) {
        await record({
          startedAt,
          endedAt: Date.now(),
          status: "error",
          errorType: err instanceof Error ? err.name : "Error",
          model,
          input: inputContent(params),
        });
        throw err;
      }
    },

    wrapStream: async ({ doStream, params, model }) => {
      const startedAt = Date.now();
      let usage: AiUsage | null | undefined;
      let finishReason: AiFinishReason | null | undefined;
      let providerMetadata: unknown;
      let streamError: unknown;
      let outputText = "";

      // A rejection of doStream() itself (auth/network/bad-request before any
      // part is emitted) is recorded as an error span and rethrown, matching
      // wrapGenerate; in-stream errors are handled by the tap below.
      const result = await Promise.resolve(doStream()).catch(
        async (err: unknown) => {
          await record({
            startedAt,
            endedAt: Date.now(),
            status: "error",
            errorType: err instanceof Error ? err.name : "Error",
            model,
            input: inputContent(params),
          });
          throw err;
        },
      );

      const tap = new TransformStream<AiStreamPart, AiStreamPart>({
        transform(chunk, controller) {
          if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
            outputText += chunk.delta;
          } else if (chunk.type === "finish") {
            usage = chunk.usage;
            finishReason = chunk.finishReason;
            providerMetadata = chunk.providerMetadata;
          } else if (chunk.type === "error") {
            streamError = chunk.error;
          }
          controller.enqueue(chunk);
        },
        async flush() {
          const errored =
            streamError !== undefined || finishReason?.unified === "error";
          await record({
            startedAt,
            endedAt: Date.now(),
            status: errored ? "error" : "success",
            ...(streamError !== undefined
              ? {
                  errorType:
                    streamError instanceof Error ? streamError.name : "Error",
                }
              : {}),
            usage,
            ...(providerMetadata !== undefined ? { providerMetadata } : {}),
            model,
            input: inputContent(params),
            output: recordContent && outputText.length > 0 ? outputText : undefined,
          });
        },
      });

      // Same result, its stream tapped for usage/content; the parts flow
      // through unchanged. Cast narrows the tapped stream back to R's
      // stream type (identical parts).
      return { ...result, stream: result.stream.pipeThrough(tap) } as typeof result;
    },
  };
}

export default evalbenchMiddleware;
