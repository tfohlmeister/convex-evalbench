import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";
import { query } from "./_generated/server.js";
import { runValidator } from "./runner.js";

/**
 * Run comparison and the CI gate.
 *
 * A run stores one result per dataset item keyed `(runId, itemId)`, and
 * dataset versions are immutable, so two runs over the same `datasetId`
 * join directly per item. `compareRuns` computes that join plus
 * aggregate stats; `evaluateGate` applies thresholds to the same
 * computation and returns a pass/fail verdict for CI. Both are queries,
 * so a client subscribing while the candidate run still executes sees
 * items move from `incomplete` to a terminal classification live.
 *
 * Eval datasets are bounded (hundreds, not millions, of items), so a
 * full `collect` of each run's results is within query limits; this is
 * the documented scale ceiling.
 */

/** A result row counts as terminal once it is `success` or `error`. */
function isTerminal(result: Doc<"eval_results">): boolean {
  return result.status === "success" || result.status === "error";
}

/**
 * The aggregate item score of a terminal result: the stored `itemScore`
 * when present, else the mean of the row's scorer scores (the legacy
 * fallback, matching `combineScores`), and 0 for an `error` row.
 * Only call for terminal rows.
 */
function itemScoreOf(result: Doc<"eval_results">): number {
  if (result.itemScore !== undefined) return result.itemScore;
  if (result.status === "error") return 0;
  const scores = result.scores ?? [];
  return scores.length === 0
    ? 1
    : scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
}

const classificationValidator = v.union(
  v.literal("regressed"),
  v.literal("improved"),
  v.literal("unchanged"),
  v.literal("incomplete"),
);
type Classification = "regressed" | "improved" | "unchanged" | "incomplete";

const itemComparisonValidator = v.object({
  itemId: v.id("eval_dataset_items"),
  baselineStatus: v.string(),
  candidateStatus: v.string(),
  baselinePassed: v.optional(v.boolean()),
  candidatePassed: v.optional(v.boolean()),
  baselineScore: v.optional(v.number()),
  candidateScore: v.optional(v.number()),
  scoreDelta: v.optional(v.number()),
  classification: classificationValidator,
});

const statsValidator = v.object({
  total: v.number(),
  regressed: v.number(),
  improved: v.number(),
  unchanged: v.number(),
  incomplete: v.number(),
  // Denominators: items terminal on each side.
  baselineTerminal: v.number(),
  candidateTerminal: v.number(),
  // Pass counts and mean item scores, each over that side's terminal items.
  baselinePassed: v.number(),
  candidatePassed: v.number(),
  baselineMeanScore: v.number(),
  candidateMeanScore: v.number(),
});
type Stats = Infer<typeof statsValidator>;

const comparisonValidator = v.object({
  baseline: runValidator,
  candidate: runValidator,
  stats: statsValidator,
  items: v.array(itemComparisonValidator),
});
type Comparison = Infer<typeof comparisonValidator>;

/**
 * Load both runs, require they reference the same dataset, and join
 * their results per item into per-item classifications plus aggregate
 * stats. Shared by `compareRuns` and `evaluateGate`.
 */
async function computeComparison(
  ctx: QueryCtx,
  baselineRunId: Id<"eval_runs">,
  candidateRunId: Id<"eval_runs">,
): Promise<Comparison> {
  const baseline = await ctx.db.get("eval_runs", baselineRunId);
  if (!baseline) throw new ConvexError(`run not found: ${baselineRunId}`);
  const candidate = await ctx.db.get("eval_runs", candidateRunId);
  if (!candidate) throw new ConvexError(`run not found: ${candidateRunId}`);
  if (baseline.datasetId !== candidate.datasetId) {
    throw new ConvexError(
      "runs are not comparable: they reference different datasets",
    );
  }

  const [baselineResults, candidateResults] = await Promise.all([
    ctx.db
      .query("eval_results")
      .withIndex("by_run", (q) => q.eq("runId", baselineRunId))
      .collect(),
    ctx.db
      .query("eval_results")
      .withIndex("by_run", (q) => q.eq("runId", candidateRunId))
      .collect(),
  ]);
  const baselineByItem = new Map(baselineResults.map((r) => [r.itemId, r]));
  const candidateByItem = new Map(
    candidateResults.map((r) => [r.itemId, r]),
  );

  const stats: Stats = {
    total: 0,
    regressed: 0,
    improved: 0,
    unchanged: 0,
    incomplete: 0,
    baselineTerminal: 0,
    candidateTerminal: 0,
    baselinePassed: 0,
    candidatePassed: 0,
    baselineMeanScore: 0,
    candidateMeanScore: 0,
  };
  let baselineScoreSum = 0;
  let candidateScoreSum = 0;
  const items: Comparison["items"] = [];

  // Union of both runs' items. Both runs cover the same dataset, so
  // normally the sets are identical; but `addItems` can mutate a live
  // dataset between two runs, so an item may exist on only one side. A
  // one-sided item is `missing` on the other (hence `incomplete`), never
  // silently dropped, so the gate cannot go false-green on unseen items.
  const itemIds: Id<"eval_dataset_items">[] = [...baselineByItem.keys()];
  for (const id of candidateByItem.keys()) {
    if (!baselineByItem.has(id)) itemIds.push(id);
  }
  for (const itemId of itemIds) {
    const base = baselineByItem.get(itemId);
    const cand = candidateByItem.get(itemId);
    const baseTerminal = base !== undefined && isTerminal(base);
    const candTerminal = cand !== undefined && isTerminal(cand);

    const entry: Comparison["items"][number] = {
      itemId,
      baselineStatus: base?.status ?? "missing",
      candidateStatus: cand?.status ?? "missing",
      classification: "incomplete",
    };

    if (base !== undefined && baseTerminal) {
      stats.baselineTerminal++;
      const score = itemScoreOf(base);
      baselineScoreSum += score;
      entry.baselinePassed = base.passed ?? false;
      entry.baselineScore = score;
      if (entry.baselinePassed) stats.baselinePassed++;
    }
    if (cand !== undefined && candTerminal) {
      stats.candidateTerminal++;
      const score = itemScoreOf(cand);
      candidateScoreSum += score;
      entry.candidatePassed = cand.passed ?? false;
      entry.candidateScore = score;
      if (entry.candidatePassed) stats.candidatePassed++;
    }
    if (
      baseTerminal &&
      candTerminal &&
      entry.baselineScore !== undefined &&
      entry.candidateScore !== undefined
    ) {
      entry.scoreDelta = entry.candidateScore - entry.baselineScore;
    }

    let classification: Classification;
    if (!baseTerminal || !candTerminal) {
      classification = "incomplete";
      stats.incomplete++;
    } else if (entry.baselinePassed && !entry.candidatePassed) {
      classification = "regressed";
      stats.regressed++;
    } else if (!entry.baselinePassed && entry.candidatePassed) {
      classification = "improved";
      stats.improved++;
    } else {
      classification = "unchanged";
      stats.unchanged++;
    }
    entry.classification = classification;
    items.push(entry);
  }

  stats.total = items.length;
  stats.baselineMeanScore =
    stats.baselineTerminal === 0
      ? 0
      : baselineScoreSum / stats.baselineTerminal;
  stats.candidateMeanScore =
    stats.candidateTerminal === 0
      ? 0
      : candidateScoreSum / stats.candidateTerminal;

  return { baseline, candidate, stats, items };
}

/**
 * Compare a candidate run against a baseline run over the same dataset:
 * per-item classification (regressed / improved / unchanged /
 * incomplete) with score deltas, plus aggregate stats. Reactive: while
 * the candidate run executes, its finalizes move items from
 * `incomplete` to a terminal classification and subscribers see the
 * comparison fill in live. Rejects runs of different datasets.
 */
export const compareRuns = query({
  args: {
    baselineRunId: v.id("eval_runs"),
    candidateRunId: v.id("eval_runs"),
  },
  returns: comparisonValidator,
  handler: async (ctx, args): Promise<Comparison> => {
    return await computeComparison(
      ctx,
      args.baselineRunId,
      args.candidateRunId,
    );
  },
});

const thresholdsValidator = v.object({
  maxRegressedItems: v.optional(v.number()),
  minPassRate: v.optional(v.number()),
  maxScoreDrop: v.optional(v.number()),
});

const verdictValidator = v.object({
  ok: v.boolean(),
  reasons: v.array(v.string()),
  stats: statsValidator,
});
type Verdict = Infer<typeof verdictValidator>;

/** A finite, non-negative threshold, floored; `fallback` otherwise. */
function saneNonNegInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) >= 0
    ? Math.floor(value as number)
    : fallback;
}

/**
 * Apply gate thresholds to a comparison and return a pass/fail verdict
 * with the failing reasons:
 *
 * - `maxRegressedItems` (default 0): more regressions than this fails.
 * - `minPassRate` (optional): candidate pass rate over terminal items
 *   below this fails.
 * - `maxScoreDrop` (optional): a baseline-minus-candidate mean-score
 *   drop above this fails.
 *
 * A candidate run that is not `completed` fails loud with an explicit
 * reason, so a CI job that forgot to wait does not gate on partial
 * data. The gate is a query (no side effects); throwing on a failing
 * verdict is the host's choice (see the CI recipe in the docs).
 */
export const evaluateGate = query({
  args: {
    baselineRunId: v.id("eval_runs"),
    candidateRunId: v.id("eval_runs"),
    thresholds: v.optional(thresholdsValidator),
  },
  returns: verdictValidator,
  handler: async (ctx, args): Promise<Verdict> => {
    const { stats, candidate } = await computeComparison(
      ctx,
      args.baselineRunId,
      args.candidateRunId,
    );

    // A run still in flight (or failed/canceled) cannot gate: fail loud
    // rather than judge on partial results.
    if (candidate.status !== "completed") {
      return { ok: false, reasons: ["candidate run not completed"], stats };
    }

    const thresholds = args.thresholds ?? {};
    const reasons: string[] = [];

    const maxRegressed = saneNonNegInt(thresholds.maxRegressedItems, 0);
    if (stats.regressed > maxRegressed) {
      reasons.push(
        `${stats.regressed} item(s) regressed (max ${maxRegressed})`,
      );
    }

    if (Number.isFinite(thresholds.minPassRate)) {
      const minPassRate = Math.min(
        Math.max(thresholds.minPassRate as number, 0),
        1,
      );
      const passRate =
        stats.candidateTerminal === 0
          ? 0
          : stats.candidatePassed / stats.candidateTerminal;
      if (passRate < minPassRate) {
        reasons.push(
          `candidate pass rate ${passRate.toFixed(2)} below ${minPassRate.toFixed(2)}`,
        );
      }
    }

    if (Number.isFinite(thresholds.maxScoreDrop)) {
      const maxScoreDrop = Math.max(thresholds.maxScoreDrop as number, 0);
      const drop = stats.baselineMeanScore - stats.candidateMeanScore;
      if (drop > maxScoreDrop) {
        reasons.push(
          `mean score dropped ${drop.toFixed(2)} (max ${maxScoreDrop.toFixed(2)})`,
        );
      }
    }

    return { ok: reasons.length === 0, reasons, stats };
  },
});

/**
 * The runs of a dataset, newest first, so a caller can locate a
 * baseline (e.g. the latest completed run of a given `targetVersion`).
 * `limit` defaults to 50, capped at 200.
 */
export const listRuns = query({
  args: { datasetId: v.id("eval_datasets"), limit: v.optional(v.number()) },
  returns: v.array(runValidator),
  handler: async (ctx, args): Promise<Doc<"eval_runs">[]> => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return await ctx.db
      .query("eval_runs")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .order("desc")
      .take(limit);
  },
});
