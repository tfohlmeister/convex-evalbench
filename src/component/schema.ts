import { defineSchema, defineTable } from "convex/server";

import { spanRowFields } from "../shared.js";

/**
 * Component storage schema.
 *
 * `eval_traces` holds one row per span (an LLM call, tool call, agent or
 * workflow step, or judge verdict). Spans are flat and linked by
 * `parentSpanId` so the client assembles the tree; this keeps writes as
 * independent inserts with no parent-document contention. The field shape
 * lives in `src/shared.ts` (`spanRowFields`) so the schema, the public
 * ingestion args, and the internal write seam stay in sync.
 *
 * Dataset, run, and result tables are added in later phases.
 */
export default defineSchema({
  eval_traces: defineTable(spanRowFields)
    // Span-tree query: all spans of a trace, oldest first.
    .index("by_trace", ["traceId", "startedAt"])
    // Recent traces are root spans (parentSpanId == undefined); also
    // serves children-by-parent lookups.
    .index("by_parent_started", ["parentSpanId", "startedAt"])
    // Phase 2 run spans.
    .index("by_run", ["runId", "startedAt"])
    // Per-thread view.
    .index("by_thread", ["threadId", "startedAt"]),
});
