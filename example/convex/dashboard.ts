import { Evalbench, datasetItemInputValidator } from "convex-evalbench";
import { v } from "convex/values";

import { components } from "./_generated/api.js";
import { mutation, query } from "./_generated/server.js";

/**
 * The dashboard host-wrapper contract.
 *
 * The companion dashboard (`/dashboard`) subscribes to this exact set of
 * host-exposed queries and mutations, never to component functions
 * directly (a browser cannot address the component, and `ctx.auth` does
 * not propagate into component code). This module is the single source
 * the dashboard depends on and the docs mirror: to run the dashboard
 * against your own deployment, copy this file into your `convex/`,
 * add any auth gate you need, and point `VITE_CONVEX_URL` at it. Keep
 * the function names stable; the dashboard references them by name.
 */
const evalbench = new Evalbench(components.evalbench);

// ---------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------

/** Recent traces (root spans), newest first. */
export const listRecentTraces = query({
  args: { limit: v.optional(v.number()) },
  handler: (ctx, args) => evalbench.recentTraces(ctx, args),
});

/** Reactive span tree for one trace, metadata only; fills in live. */
export const spansByTrace = query({
  args: { traceId: v.string() },
  handler: (ctx, args) => evalbench.spansByTrace(ctx, args.traceId),
});

/** On-demand content for one span (inline strings plus signed URLs). */
export const spanContent = query({
  args: { spanId: v.string() },
  handler: (ctx, args) => evalbench.spanContent(ctx, args.spanId),
});

// ---------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------

/** List datasets; archived ones only when `includeArchived` is set. */
export const listDatasets = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: (ctx, args) => evalbench.listDatasets(ctx, args),
});

/** All items of a dataset. */
export const listItems = query({
  args: { datasetId: v.string() },
  handler: (ctx, args) => evalbench.listItems(ctx, args.datasetId),
});

/** Create a dataset at version 1, optionally with initial items. */
export const createDataset = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    items: v.optional(v.array(datasetItemInputValidator)),
  },
  handler: (ctx, args) => evalbench.createDataset(ctx, args),
});

/** Snapshot a dataset into a new immutable version. */
export const versionDataset = mutation({
  args: { datasetId: v.string() },
  handler: (ctx, args) => evalbench.versionDataset(ctx, args.datasetId),
});

/** Archive a dataset; it disappears from the default listing. */
export const archiveDataset = mutation({
  args: { datasetId: v.string() },
  handler: (ctx, args) => evalbench.archiveDataset(ctx, args.datasetId),
});

// ---------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------

/**
 * All runs across every dataset, newest first. Composes the per-dataset
 * `listRuns` over the (bounded) dataset set so the runs view has a
 * single top-level list; no component change is needed.
 */
export const listAllRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const datasets = await evalbench.listDatasets(ctx, {
      includeArchived: true,
    });
    // Fetch up to the requested global window from each dataset (the
    // component caps `listRuns` at 200), so a dataset's newer runs are
    // never dropped below the global limit by a per-dataset default.
    const perDatasetLimit = args.limit ?? 200;
    const perDataset = await Promise.all(
      datasets.map((d) =>
        evalbench.listRuns(ctx, { datasetId: d._id, limit: perDatasetLimit }),
      ),
    );
    const runs = perDataset.flat().sort((a, b) => b.startedAt - a.startedAt);
    return args.limit ? runs.slice(0, args.limit) : runs;
  },
});

/** The runs of one dataset, newest first (baseline/candidate pickers). */
export const listRuns = query({
  args: { datasetId: v.string(), limit: v.optional(v.number()) },
  handler: (ctx, args) => evalbench.listRuns(ctx, args),
});

/** Live run summary (counters fill in as items are scored). */
export const runSummary = query({
  args: { runId: v.string() },
  handler: (ctx, args) => evalbench.runSummary(ctx, args.runId),
});

/** Per-item results of a run, with scores and trace ids. */
export const listResults = query({
  args: { runId: v.string() },
  handler: (ctx, args) => evalbench.listResults(ctx, args.runId),
});

/** Recover a wedged run: re-pend stuck items and reschedule a worker. */
export const redriveRun = mutation({
  args: { runId: v.string(), olderThanMs: v.optional(v.number()) },
  handler: (ctx, args) =>
    evalbench.redriveRun(ctx, args.runId, {
      ...(args.olderThanMs !== undefined
        ? { olderThanMs: args.olderThanMs }
        : {}),
    }),
});

// ---------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------

/** Per-item comparison of a candidate run against a baseline run. */
export const compareRuns = query({
  args: { baselineRunId: v.string(), candidateRunId: v.string() },
  handler: (ctx, args) => evalbench.compareRuns(ctx, args),
});

/** Threshold gate verdict for a candidate run against a baseline run. */
export const evaluateGate = query({
  args: {
    baselineRunId: v.string(),
    candidateRunId: v.string(),
    thresholds: v.optional(
      v.object({
        maxRegressedItems: v.optional(v.number()),
        minPassRate: v.optional(v.number()),
        maxScoreDrop: v.optional(v.number()),
      }),
    ),
  },
  handler: (ctx, args) => evalbench.evaluateGate(ctx, args),
});
