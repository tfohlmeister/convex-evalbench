import type { Evalbench, RunActionCtx } from "./index.js";

/**
 * `withEvalbench` adapter: one optional ingestion source that wraps a
 * `@convex-dev/agent` agent so each LLM call it makes is recorded as a
 * span via the tracing ingestion API.
 *
 * The tracing core does not depend on this module, and this module does
 * not import `@convex-dev/agent`: the agent is described structurally
 * (only the parts the adapter touches) so the core builds and tests
 * without the optional peer installed. A host passes its real `Agent`;
 * structural typing keeps that type-safe.
 *
 * Mechanism (see design.md spike outcomes R2/R3/R4):
 * - Handlers are injected by mutating `agent.options` after construction,
 *   which the agent reads per call. Existing host handlers are composed
 *   with, not clobbered.
 * - Awaitable top-level operations (`generateText`, `generateObject`) are
 *   wrapped to open a per-operation `traceId` and a root `agent_step`
 *   span (recorded at completion), so the LLM calls within one operation
 *   share a trace and link to that root.
 * - Raw request/response content (when opted in) is correlated with usage
 *   within a step via a single pending-content slot.
 */

/** Token usage as the agent's `usageHandler` reports it (AI SDK shape). */
interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Args the agent passes to `usageHandler`. */
export interface AgentUsageArgs {
  userId?: string;
  threadId?: string;
  agentName?: string;
  usage?: AgentUsage;
  providerMetadata?: unknown;
  model: string;
  provider: string;
}

/** Args the agent passes to `rawRequestResponseHandler`. */
export interface AgentRawArgs {
  userId?: string;
  threadId?: string;
  agentName?: string;
  request: unknown;
  response: unknown;
}

/**
 * Structural subset of a `@convex-dev/agent` `Agent` the adapter wraps.
 * A real `Agent` is assignable to this; the loose handler/method
 * signatures avoid a compile-time dependency on the optional package.
 */
export interface AgentLike {
  options: {
    name?: string;
    usageHandler?: (ctx: any, args: any) => unknown;
    rawRequestResponseHandler?: (ctx: any, args: any) => unknown;
  };
  generateText?: (...args: any[]) => Promise<unknown>;
  generateObject?: (...args: any[]) => Promise<unknown>;
}

export interface WithEvalbenchOptions {
  evalbench: Evalbench;
  /**
   * Record raw request/response as span content. Default false: metadata
   * only. Delegates inline-versus-File-Storage handling to the ingestion
   * API.
   */
  recordContent?: boolean;
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

/**
 * Wrap a `@convex-dev/agent` agent so its LLM calls are recorded as spans.
 * Mutates and returns the same agent (its `options` and the wrapped
 * generate methods), composing with any handlers the host already set.
 */
export function withEvalbench<A extends AgentLike>(
  agent: A,
  options: WithEvalbenchOptions,
): A {
  const { evalbench, recordContent = false } = options;

  // Per-operation trace context. A stack so a nested wrapped call (agent
  // calling agent) groups under its own root. Reliable for sequentially
  // awaited operations; concurrent operations on the same agent instance
  // share this and may mis-group (use separate instances for concurrency).
  const traceStack: Array<{ traceId: string; rootSpanId: string }> = [];
  const currentTrace = () => traceStack[traceStack.length - 1];

  // Raw content for the current LLM step: filled by the raw handler,
  // drained by the usage handler that fires immediately after it.
  let pendingContent: { input?: string; output?: string } | undefined;

  const opts = agent.options as {
    name?: string;
    usageHandler?: (ctx: RunActionCtx, args: AgentUsageArgs) => unknown;
    rawRequestResponseHandler?: (
      ctx: RunActionCtx,
      args: AgentRawArgs,
    ) => unknown;
  };
  const hostUsage = opts.usageHandler;
  const hostRaw = opts.rawRequestResponseHandler;

  opts.rawRequestResponseHandler = async (ctx, args) => {
    if (hostRaw) await hostRaw(ctx, args);
    if (!recordContent) return;
    pendingContent = {
      input: safeStringify(args.request),
      output: safeStringify(args.response),
    };
  };

  opts.usageHandler = async (ctx, args) => {
    if (hostUsage) await hostUsage(ctx, args);
    const trace = currentTrace();
    const content = pendingContent;
    pendingContent = undefined;
    // `usageHandler` is a post-response hook: it fires after the LLM call
    // completes and carries no call-start time. So `startedAt`/`endedAt`
    // both reflect completion and `latencyMs` is left unset for adapter
    // spans (see docs/tracing.md limitations).
    const now = Date.now();
    await evalbench.recordSpan(ctx, {
      traceId: trace?.traceId ?? crypto.randomUUID(),
      spanId: crypto.randomUUID(),
      ...(trace ? { parentSpanId: trace.rootSpanId } : {}),
      kind: "llm",
      operationName: "llm call",
      ...(args.agentName ? { agentName: args.agentName } : {}),
      ...(args.threadId ? { threadId: args.threadId } : {}),
      ...(args.userId ? { userId: args.userId } : {}),
      model: args.model,
      provider: args.provider,
      ...(args.usage?.inputTokens !== undefined
        ? { inputTokens: args.usage.inputTokens }
        : {}),
      ...(args.usage?.outputTokens !== undefined
        ? { outputTokens: args.usage.outputTokens }
        : {}),
      ...(args.usage?.totalTokens !== undefined
        ? { totalTokens: args.usage.totalTokens }
        : {}),
      status: "success",
      startedAt: now,
      endedAt: now,
      ...(content?.input !== undefined ? { input: content.input } : {}),
      ...(content?.output !== undefined ? { output: content.output } : {}),
      ...(args.providerMetadata !== undefined
        ? { metadata: args.providerMetadata }
        : {}),
    });
  };

  for (const method of ["generateText", "generateObject"] as const) {
    const original = agent[method];
    if (typeof original !== "function") continue;
    const bound = (original as (...a: unknown[]) => Promise<unknown>).bind(
      agent,
    );
    (agent as Record<string, unknown>)[method] = async (
      ...args: unknown[]
    ): Promise<unknown> => {
      // The agent's generate methods take the ActionCtx as the first arg.
      const ctx = args[0] as RunActionCtx;
      const traceId = crypto.randomUUID();
      const rootSpanId = crypto.randomUUID();
      traceStack.push({ traceId, rootSpanId });
      const startedAt = Date.now();
      let status: "success" | "error" = "success";
      let errorType: string | undefined;
      try {
        return await bound(...args);
      } catch (err) {
        status = "error";
        errorType = err instanceof Error ? err.name : "Error";
        throw err;
      } finally {
        traceStack.pop();
        // Record the root at completion (children already streamed in).
        // Best-effort: recordSpan swallows its own errors.
        await evalbench.recordSpan(ctx, {
          traceId,
          spanId: rootSpanId,
          kind: "agent_step",
          operationName: opts.name ? `${opts.name} run` : "agent run",
          ...(opts.name ? { agentName: opts.name } : {}),
          status,
          ...(errorType ? { errorType } : {}),
          startedAt,
          endedAt: Date.now(),
        });
      }
    };
  }

  return agent;
}

export default withEvalbench;
