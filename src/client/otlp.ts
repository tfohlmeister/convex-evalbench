import type { SpanInput } from "../shared.js";
import type { Evalbench, RunActionCtx } from "./index.js";

/**
 * OTLP trace receiver: a handler factory a host mounts as an HTTP route
 * (`httpAction`) so any OpenTelemetry-instrumented app can stream its LLM
 * spans into the deployment. It parses OTLP/JSON, maps each OTel span onto
 * a tracing span (using GenAI semantic conventions), and records it through
 * the ingestion API.
 *
 * Scope (see design.md): OTLP/JSON only; protobuf is answered with 415.
 * Malformed spans are skipped and reported via OTLP `partialSuccess`
 * instead of failing the whole export. Content is opt-in. The host owns the
 * route and its auth (an optional `authorize` hook is provided).
 */

/** How many spans one metadata batch writes (bounds the transaction). */
const BATCH_CHUNK = 256;

/** Default cap on spans ingested per request. */
const DEFAULT_MAX_SPANS = 1000;

/** Guards `anyValue` recursion against hostile deeply-nested attributes. */
const MAX_ATTR_DEPTH = 32;

/**
 * GenAI attributes that hold raw prompt/response content. They are kept out
 * of `metadata` and surfaced only as `input`/`output`, so the
 * `recordContent` opt-in fully governs whether content is ever persisted.
 */
const CONTENT_ATTR_KEYS = [
  "gen_ai.prompt",
  "gen_ai.input.messages",
  "gen_ai.completion",
  "gen_ai.output.messages",
];

/** Unwrap an OTLP/JSON AnyValue to a plain JS value (depth-bounded). */
function anyValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_ATTR_DEPTH) return undefined;
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if ("stringValue" in v) return v.stringValue;
  if ("boolValue" in v) return v.boolValue;
  if ("intValue" in v)
    return typeof v.intValue === "string" ? Number(v.intValue) : v.intValue;
  if ("doubleValue" in v) return v.doubleValue;
  if ("arrayValue" in v) {
    const values = (v.arrayValue as { values?: unknown[] })?.values ?? [];
    return values.map((item) => anyValue(item, depth + 1));
  }
  if ("kvlistValue" in v) {
    const values = (v.kvlistValue as { values?: unknown[] })?.values ?? [];
    return attrsToRecord(values, depth + 1);
  }
  if ("bytesValue" in v) return v.bytesValue;
  return undefined;
}

/** Turn an OTLP `attributes` array into a plain record (depth-bounded). */
function attrsToRecord(
  attributes: unknown,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(attributes) || depth > MAX_ATTR_DEPTH) return out;
  for (const attr of attributes) {
    const key = (attr as { key?: unknown })?.key;
    if (typeof key === "string") {
      out[key] = anyValue((attr as { value?: unknown })?.value, depth + 1);
    }
  }
  return out;
}

function num(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function str(x: unknown): string | undefined {
  if (x === undefined || x === null) return undefined;
  return typeof x === "string" ? x : String(x);
}

/** OTLP timestamps are uint64 nanoseconds; round to integer milliseconds. */
function nanoToMs(x: unknown): number | undefined {
  const n = num(x);
  return n === undefined ? undefined : Math.round(n / 1e6);
}

function contentOf(x: unknown): string | undefined {
  if (x === undefined || x === null) return undefined;
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return undefined;
  }
}

/** OTLP status code ERROR, encoded as the int `2` or the string enum. */
function isError(status: unknown): boolean {
  const code = (status as { code?: unknown })?.code;
  return code === 2 || code === "STATUS_CODE_ERROR";
}

/**
 * Map one OTLP span (with the resource/scope attributes merged in as
 * `baseAttrs`) onto a `SpanInput`. Throws on a span missing the required
 * identity/timing, so the receiver can count it as a rejected span.
 */
export function mapOtlpSpan(
  span: unknown,
  baseAttrs: Record<string, unknown>,
): SpanInput {
  const s = span as Record<string, unknown>;
  const traceId = s?.traceId;
  const spanId = s?.spanId;
  if (typeof traceId !== "string" || traceId.length === 0) {
    throw new Error("span missing traceId");
  }
  if (typeof spanId !== "string" || spanId.length === 0) {
    throw new Error("span missing spanId");
  }
  const startedAt = nanoToMs(s.startTimeUnixNano);
  if (startedAt === undefined) {
    throw new Error("span missing startTimeUnixNano");
  }
  const endedAt = nanoToMs(s.endTimeUnixNano);
  const latencyMs =
    endedAt !== undefined && endedAt >= startedAt ? endedAt - startedAt : undefined;

  const attrs = { ...baseAttrs, ...attrsToRecord(s.attributes) };
  const provider = str(attrs["gen_ai.system"]);
  const model = str(attrs["gen_ai.request.model"] ?? attrs["gen_ai.response.model"]);
  const inputTokens = num(
    attrs["gen_ai.usage.input_tokens"] ?? attrs["gen_ai.usage.prompt_tokens"],
  );
  const outputTokens = num(
    attrs["gen_ai.usage.output_tokens"] ?? attrs["gen_ai.usage.completion_tokens"],
  );
  const isGenAi =
    provider !== undefined ||
    model !== undefined ||
    Object.keys(attrs).some((k) => k.startsWith("gen_ai."));

  const parentSpanId =
    typeof s.parentSpanId === "string" && s.parentSpanId.length > 0
      ? s.parentSpanId
      : undefined;
  const errored = isError(s.status);
  const errorType = errored
    ? (str((s.status as { message?: unknown })?.message) ??
      str(attrs["exception.type"]) ??
      "error")
    : undefined;

  const input = contentOf(attrs["gen_ai.prompt"] ?? attrs["gen_ai.input.messages"]);
  const output = contentOf(
    attrs["gen_ai.completion"] ?? attrs["gen_ai.output.messages"],
  );

  // Raw content lives only in input/output (gated by the recordContent
  // opt-in), never in the always-stored metadata.
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!CONTENT_ATTR_KEYS.includes(key)) metadata[key] = value;
  }

  return {
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    kind: isGenAi ? "llm" : "workflow_step",
    operationName: str(s.name) ?? "span",
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(inputTokens !== undefined && outputTokens !== undefined
      ? { totalTokens: inputTokens + outputTokens }
      : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    status: errored ? "error" : "success",
    ...(errorType ? { errorType } : {}),
    startedAt,
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

export interface OtlpTraceHandlerOptions {
  evalbench: Evalbench;
  /**
   * Record the GenAI prompt/completion attributes as span content (default
   * false: metadata only). Delegates inline-versus-File-Storage handling to
   * the ingestion API.
   */
  recordContent?: boolean;
  /**
   * Optional gate run before the body is read; returning false answers
   * `401`. Put a shared-secret or bearer check here (an open OTLP endpoint
   * is an abuse vector).
   */
  authorize?: (request: Request) => boolean | Promise<boolean>;
  /** Cap on spans ingested per request; the overflow is rejected. */
  maxSpans?: number;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build an OTLP/JSON trace receiver. Mount the returned handler in your
 * `convex/http.ts`:
 *
 * ```ts
 * http.route({
 *   path: "/v1/traces",
 *   method: "POST",
 *   handler: httpAction(otlpTraceHandler({ evalbench })),
 * });
 * ```
 */
export function otlpTraceHandler(options: OtlpTraceHandlerOptions) {
  const {
    evalbench,
    recordContent = false,
    authorize,
    maxSpans = DEFAULT_MAX_SPANS,
  } = options;

  return async (ctx: RunActionCtx, request: Request): Promise<Response> => {
    if (authorize && !(await authorize(request))) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-protobuf")) {
      return new Response(
        "OTLP protobuf is not supported; set the exporter protocol to http/json (OTEL_EXPORTER_OTLP_PROTOCOL=http/json).",
        { status: 415, headers: { "content-type": "text/plain" } },
      );
    }

    let payload: { resourceSpans?: unknown };
    try {
      payload = (await request.json()) as { resourceSpans?: unknown };
    } catch {
      return jsonResponse(400, { error: "Request body is not valid OTLP/JSON." });
    }
    if (!payload || !Array.isArray(payload.resourceSpans)) {
      return jsonResponse(400, {
        error: "Request body is not a valid OTLP trace export.",
      });
    }

    const accepted: SpanInput[] = [];
    let rejected = 0;

    for (const rs of payload.resourceSpans as Array<Record<string, unknown>>) {
      const resourceAttrs = attrsToRecord(
        (rs?.resource as { attributes?: unknown })?.attributes,
      );
      const scopeSpans = (rs?.scopeSpans as Array<Record<string, unknown>>) ?? [];
      for (const ss of scopeSpans) {
        const scopeAttrs = attrsToRecord(
          (ss?.scope as { attributes?: unknown })?.attributes,
        );
        const base = { ...resourceAttrs, ...scopeAttrs };
        const spans = (ss?.spans as unknown[]) ?? [];
        for (const span of spans) {
          if (accepted.length >= maxSpans) {
            rejected++;
            continue;
          }
          try {
            const mapped = mapOtlpSpan(span, base);
            if (!recordContent) {
              delete mapped.input;
              delete mapped.output;
            }
            accepted.push(mapped);
          } catch {
            rejected++;
          }
        }
      }
    }

    await writeSpans(ctx, evalbench, accepted, recordContent);

    const body =
      rejected > 0
        ? {
            partialSuccess: {
              rejectedSpans: rejected,
              errorMessage: `${rejected} span(s) rejected`,
            },
          }
        : {};
    return jsonResponse(200, body);
  };
}

/**
 * Write accepted spans: metadata-only spans go through the batch seam in
 * bounded chunks; content-bearing spans (only when content recording is on)
 * take the per-span content path.
 */
async function writeSpans(
  ctx: RunActionCtx,
  evalbench: Evalbench,
  spans: SpanInput[],
  recordContent: boolean,
): Promise<void> {
  const metaOnly = recordContent
    ? spans.filter((s) => s.input === undefined && s.output === undefined)
    : spans;
  const withContent = recordContent
    ? spans.filter((s) => s.input !== undefined || s.output !== undefined)
    : [];

  for (let i = 0; i < metaOnly.length; i += BATCH_CHUNK) {
    await evalbench.recordSpans(ctx, metaOnly.slice(i, i + BATCH_CHUNK));
  }
  for (const span of withContent) {
    await evalbench.recordSpan(ctx, span);
  }
}

export default otlpTraceHandler;
