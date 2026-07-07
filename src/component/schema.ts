import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  datasetItemFields,
  resultStatusValidator,
  runConfigValidator,
  runStatusValidator,
  scoreRecordValidator,
  spanRowFields,
} from "../shared.js";

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
 * `eval_datasets` / `eval_dataset_items` store versioned evaluation
 * datasets; a dataset row is one immutable version. `eval_runs` /
 * `eval_results` store run lifecycle and one result row per run item;
 * the run row carries denormalized counters so the summary read is one
 * row that updates live as workers finalize items.
 */
export default defineSchema({
  eval_traces: defineTable(spanRowFields)
    // Span-tree query: all spans of a trace, oldest first.
    .index("by_trace", ["traceId", "startedAt"])
    // Recent traces are root spans (parentSpanId == undefined); also
    // serves children-by-parent lookups.
    .index("by_parent_started", ["parentSpanId", "startedAt"])
    // Spans recorded during an eval run.
    .index("by_run", ["runId", "startedAt"])
    // Per-thread view.
    .index("by_thread", ["threadId", "startedAt"])
    // Age-ordered scan for retention pruning (delete spans older than a
    // cutoff); the other indexes are all prefixed by another field.
    .index("by_started", ["startedAt"]),

  eval_datasets: defineTable({
    name: v.string(),
    // Monotonic per name; `versionDataset` snapshots a new row.
    version: v.number(),
    parentVersionId: v.optional(v.id("eval_datasets")),
    description: v.optional(v.string()),
    // Denormalized; maintained by item writes.
    itemCount: v.number(),
    archived: v.boolean(),
  })
    .index("by_name", ["name", "version"])
    // Serve the default `listDatasets` (non-archived) from the index
    // instead of scanning archived rows and filtering in memory.
    .index("by_archived", ["archived"]),

  eval_dataset_items: defineTable({
    datasetId: v.id("eval_datasets"),
    ...datasetItemFields,
  }).index("by_dataset", ["datasetId"]),

  eval_runs: defineTable({
    datasetId: v.id("eval_datasets"),
    // Function handle of the host's target action (the system under test).
    targetHandle: v.string(),
    // Label of the system under test, e.g. "prompt-v2".
    targetVersion: v.optional(v.string()),
    targetEnv: v.optional(v.string()),
    triggeredBy: v.optional(v.string()),
    status: runStatusValidator,
    // Selected scorers, concurrency, passThreshold, maxAttempts. Every
    // write goes through `startRunArgs` (this same validator), so the
    // stored shape and the read path stay in sync and typed.
    config: runConfigValidator,
    itemCount: v.number(),
    completedCount: v.number(),
    passedCount: v.number(),
    // Running mean of per-item scores; final once the run completes.
    summaryScore: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_dataset", ["datasetId", "startedAt"])
    .index("by_status", ["status", "startedAt"]),

  eval_results: defineTable({
    runId: v.id("eval_runs"),
    itemId: v.id("eval_dataset_items"),
    status: resultStatusValidator,
    // Set on claim; the stuck-row re-drive uses it as the age cutoff.
    claimedAt: v.optional(v.number()),
    output: v.optional(v.any()),
    scores: v.optional(v.array(scoreRecordValidator)),
    passed: v.optional(v.boolean()),
    // Aggregate score folded into the run mean; stored so per-item
    // compares need no recomputation. Optional: rows finalized before
    // this field existed fall back to the mean of `scores` on read.
    itemScore: v.optional(v.number()),
    traceId: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    errorType: v.optional(v.string()),
    attempts: v.number(),
  })
    // Claim (pending rows of a run) and list (all rows of a run).
    .index("by_run", ["runId", "status"])
    // Per-item idempotency lookup.
    .index("by_run_item", ["runId", "itemId"]),
});
