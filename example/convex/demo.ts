import { Evalbench } from "convex-evalbench";
import { v } from "convex/values";

import { components } from "./_generated/api.js";
import { action, query } from "./_generated/server.js";

const evalbench = new Evalbench(components.evalbench);

/**
 * Reactive span tree for a trace, exposed by the host. A browser client
 * subscribes here and the component query streams new spans in live.
 */
export const listSpans = query({
  args: { traceId: v.string() },
  handler: (ctx, args) => evalbench.spansByTrace(ctx, args.traceId),
});

/** Recent traces (root spans), newest first. */
export const listRecentTraces = query({
  args: { limit: v.optional(v.number()) },
  handler: (ctx, args) => evalbench.recentTraces(ctx, args),
});

/** On-demand content for one span (inline strings plus signed URLs). */
export const getSpanContent = query({
  args: { spanId: v.string() },
  handler: (ctx, args) => evalbench.spanContent(ctx, args.spanId),
});

/**
 * Record a small demo trace through the generic, source-agnostic API: one
 * root `agent_step` span and two child `llm` spans linked by
 * `parentSpanId`. The two children carry raw content, so they exercise the
 * File-Storage-backed content path; the root is metadata only. Returns the
 * `traceId` so a caller can subscribe to `spansByTrace` and watch the tree.
 */
export const recordDemoTrace = action({
  args: {},
  returns: v.object({ traceId: v.string(), rootSpanId: v.string() }),
  handler: async (ctx) => {
    const traceId = crypto.randomUUID();
    const rootSpanId = crypto.randomUUID();
    const now = Date.now();

    await evalbench.recordSpan(ctx, {
      traceId,
      spanId: rootSpanId,
      kind: "agent_step",
      operationName: "demo agent run",
      status: "success",
      startedAt: now,
      endedAt: now + 60,
    });

    for (let i = 0; i < 2; i++) {
      await evalbench.recordSpan(ctx, {
        traceId,
        spanId: crypto.randomUUID(),
        parentSpanId: rootSpanId,
        kind: "llm",
        operationName: `llm call ${i + 1}`,
        model: "demo-model",
        provider: "demo",
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        status: "success",
        startedAt: now + i * 10,
        endedAt: now + i * 10 + 5,
        input: `prompt ${i + 1}`,
        output: `completion ${i + 1}`,
      });
    }

    return { traceId, rootSpanId };
  },
});

/**
 * Append one more child span to an existing trace. Used to demonstrate
 * that a `spansByTrace` subscription receives new spans live, without the
 * client re-querying.
 */
export const addDemoSpan = action({
  args: { traceId: v.string(), parentSpanId: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const spanId = crypto.randomUUID();
    await evalbench.recordSpan(ctx, {
      traceId: args.traceId,
      spanId,
      ...(args.parentSpanId ? { parentSpanId: args.parentSpanId } : {}),
      kind: "llm",
      operationName: "follow-up call",
      model: "demo-model",
      provider: "demo",
      status: "success",
      startedAt: Date.now(),
    });
    return spanId;
  },
});
