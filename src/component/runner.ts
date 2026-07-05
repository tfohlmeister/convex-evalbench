import type { FunctionHandle } from "convex/server";
import { ConvexError, v } from "convex/values";

import { exactMatch, jsonSchema } from "../scorers.js";
import type { RunConfig, ScoreRecord } from "../shared.js";
import {
  DEFAULT_RUN_CONCURRENCY,
  MAX_RUN_CONCURRENCY,
  runConfigValidator,
  runStatusValidator,
  scoreRecordValidator,
} from "../shared.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server.js";

/**
 * The eval runner: bounded parallelism via a claim pattern, no external
 * work-queue dependency.
 *
 * `startRun` creates the run plus one `pending` result per dataset item,
 * then schedules N worker actions. Each worker loops: claim the next
 * pending result (a serializable mutation, so exactly one worker wins a
 * row), invoke the host's target handle, score the output, finalize the
 * result and bump the run counters. The claim transition (`pending` ->
 * `running`) plus terminal-result immutability in `finalize` make items
 * process at most once even if execution is re-driven with extra
 * workers; `claimNext` hands out no work unless the run is `running`,
 * so a terminal run cannot be re-entered.
 */

/** What the runner sends the target action for one item. */
type TargetArgs = { input: unknown; runId: string; itemId: string };

const runValidator = v.object({
  _id: v.id("eval_runs"),
  _creationTime: v.number(),
  datasetId: v.id("eval_datasets"),
  targetHandle: v.string(),
  targetVersion: v.optional(v.string()),
  targetEnv: v.optional(v.string()),
  triggeredBy: v.optional(v.string()),
  status: runStatusValidator,
  config: v.any(),
  itemCount: v.number(),
  completedCount: v.number(),
  passedCount: v.number(),
  summaryScore: v.optional(v.number()),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
});

const resultValidator = v.object({
  _id: v.id("eval_results"),
  _creationTime: v.number(),
  runId: v.id("eval_runs"),
  itemId: v.id("eval_dataset_items"),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("success"),
    v.literal("error"),
  ),
  output: v.optional(v.any()),
  scores: v.optional(v.array(scoreRecordValidator)),
  passed: v.optional(v.boolean()),
  traceId: v.optional(v.string()),
  latencyMs: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  errorType: v.optional(v.string()),
  attempts: v.number(),
});

/** Score one output with the scorers selected in the run config. */
export function scoreOutput(
  config: RunConfig,
  output: unknown,
  expectedOutput: unknown,
): { scores: ScoreRecord[]; passed: boolean; itemScore: number } {
  const scores: ScoreRecord[] = config.scorers.map((scorer) => {
    const verdict =
      scorer.type === "exactMatch"
        ? exactMatch({ output, expectedOutput })
        : jsonSchema({ output }, scorer.schema as Record<string, unknown>);
    return {
      scorer: scorer.type,
      score: verdict.score,
      passed: verdict.passed,
      ...(verdict.details !== undefined ? { details: verdict.details } : {}),
    };
  });
  // Overall pass: every applied scorer passes (vacuously true when the
  // config selects no scorers). Item score: mean of scorer scores, 1
  // when there is nothing to score.
  const passed = scores.every((s) => s.passed);
  const itemScore =
    scores.length === 0
      ? 1
      : scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  return { scores, passed, itemScore };
}

const startRunArgs = {
  datasetId: v.id("eval_datasets"),
  targetHandle: v.string(),
  config: runConfigValidator,
  targetVersion: v.optional(v.string()),
  targetEnv: v.optional(v.string()),
  triggeredBy: v.optional(v.string()),
};

type StartRunArgs = {
  datasetId: Id<"eval_datasets">;
  targetHandle: string;
  config: RunConfig;
  targetVersion?: string;
  targetEnv?: string;
  triggeredBy?: string;
};

/** Insert the run row plus one `pending` result per dataset item. An
 * empty dataset yields an immediately-`completed` run. */
async function insertRunAndResults(
  ctx: MutationCtx,
  args: StartRunArgs,
): Promise<{ runId: Id<"eval_runs">; itemCount: number }> {
  const dataset = await ctx.db.get("eval_datasets", args.datasetId);
  if (!dataset) {
    throw new ConvexError(`dataset not found: ${args.datasetId}`);
  }
  const items = await ctx.db
    .query("eval_dataset_items")
    .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
    .collect();
  const now = Date.now();
  const runId = await ctx.db.insert("eval_runs", {
    datasetId: args.datasetId,
    targetHandle: args.targetHandle,
    ...(args.targetVersion !== undefined
      ? { targetVersion: args.targetVersion }
      : {}),
    ...(args.targetEnv !== undefined ? { targetEnv: args.targetEnv } : {}),
    ...(args.triggeredBy !== undefined
      ? { triggeredBy: args.triggeredBy }
      : {}),
    status: items.length === 0 ? "completed" : "running",
    config: args.config,
    itemCount: items.length,
    completedCount: 0,
    passedCount: 0,
    startedAt: now,
    ...(items.length === 0 ? { completedAt: now } : {}),
  });
  for (const item of items) {
    await ctx.db.insert("eval_results", {
      runId,
      itemId: item._id,
      status: "pending",
      attempts: 0,
    });
  }
  return { runId, itemCount: items.length };
}

/** Test seam: run/result creation without worker scheduling. */
export const createRun = internalMutation({
  args: startRunArgs,
  returns: v.object({ runId: v.id("eval_runs"), itemCount: v.number() }),
  handler: async (ctx, args) => {
    return await insertRunAndResults(ctx, args);
  },
});

/**
 * Claim the next pending result of a run: patch it to `running` and
 * return it with its item and the run's target/config. Serializable, so
 * two workers cannot win the same row. Returns null when nothing is
 * claimable, including when the run is not `running` (the re-entry
 * guard for terminal runs).
 */
export const claimNext = internalMutation({
  args: { runId: v.id("eval_runs") },
  returns: v.union(
    v.null(),
    v.object({
      resultId: v.id("eval_results"),
      itemId: v.id("eval_dataset_items"),
      input: v.any(),
      expectedOutput: v.optional(v.any()),
      targetHandle: v.string(),
      config: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("eval_runs", args.runId);
    if (!run || run.status !== "running") return null;
    const result = await ctx.db
      .query("eval_results")
      .withIndex("by_run", (q) =>
        q.eq("runId", args.runId).eq("status", "pending"),
      )
      .first();
    if (!result) return null;
    const item = await ctx.db.get("eval_dataset_items", result.itemId);
    if (!item) {
      // Items are never deleted in this phase; a missing item means the
      // row set is inconsistent, which should surface loudly.
      throw new ConvexError(`dataset item not found: ${result.itemId}`);
    }
    await ctx.db.patch("eval_results", result._id, {
      status: "running",
      attempts: result.attempts + 1,
    });
    return {
      resultId: result._id,
      itemId: item._id,
      input: item.input,
      ...(item.expectedOutput !== undefined
        ? { expectedOutput: item.expectedOutput }
        : {}),
      targetHandle: run.targetHandle,
      config: run.config,
    };
  },
});

/**
 * Write a claimed result's terminal state and bump the run counters
 * (completed / passed / running mean score). The worker that finalizes
 * the last item marks the run `completed`. A result that is already
 * terminal is left unchanged (at-most-once), and the counters are
 * bumped in the same mutation that writes the result, so summary and
 * results can never disagree.
 */
export const finalize = internalMutation({
  args: {
    resultId: v.id("eval_results"),
    status: v.union(v.literal("success"), v.literal("error")),
    output: v.optional(v.any()),
    scores: v.optional(v.array(scoreRecordValidator)),
    passed: v.boolean(),
    itemScore: v.number(),
    traceId: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    errorType: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await ctx.db.get("eval_results", args.resultId);
    if (!result) throw new ConvexError(`result not found: ${args.resultId}`);
    if (result.status === "success" || result.status === "error") return null;
    const { resultId, itemScore, ...terminal } = args;
    await ctx.db.patch("eval_results", resultId, terminal);

    const run = await ctx.db.get("eval_runs", result.runId);
    if (!run) throw new ConvexError(`run not found: ${result.runId}`);
    const completedCount = run.completedCount + 1;
    const summaryScore =
      ((run.summaryScore ?? 0) * run.completedCount + itemScore) /
      completedCount;
    await ctx.db.patch("eval_runs", run._id, {
      completedCount,
      passedCount: run.passedCount + (args.passed ? 1 : 0),
      summaryScore,
      ...(completedCount === run.itemCount
        ? { status: "completed" as const, completedAt: Date.now() }
        : {}),
    });
    return null;
  },
});

/**
 * How long one worker action keeps claiming items before it hands over
 * to a freshly scheduled successor. Well under Convex's 10-minute
 * action limit, so a run over a large dataset is never bounded by a
 * single action's time budget.
 */
export const WORKER_TIME_BUDGET_MS = 4 * 60 * 1000;

/**
 * One worker: loop claim -> invoke the target -> score -> finalize,
 * until no pending result remains. A target failure is recorded as an
 * `error` result and the loop continues with the next item. When the
 * time budget is spent and work remains, the worker schedules a
 * successor instead of risking the action time limit.
 */
export const worker = internalAction({
  args: { runId: v.id("eval_runs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const budgetEndsAt = Date.now() + WORKER_TIME_BUDGET_MS;
    for (;;) {
      if (Date.now() >= budgetEndsAt) {
        await ctx.scheduler.runAfter(0, internal.runner.worker, {
          runId: args.runId,
        });
        return null;
      }
      const claim = await ctx.runMutation(internal.runner.claimNext, {
        runId: args.runId,
      });
      if (!claim) return null;

      const config = claim.config as RunConfig;
      const startedAt = Date.now();
      try {
        const target = claim.targetHandle as FunctionHandle<
          "action",
          TargetArgs,
          { output: unknown; traceId?: string }
        >;
        const targetResult = await ctx.runAction(target, {
          input: claim.input,
          runId: args.runId,
          itemId: claim.itemId,
        });
        const { scores, passed, itemScore } = scoreOutput(
          config,
          targetResult.output,
          claim.expectedOutput,
        );
        await ctx.runMutation(internal.runner.finalize, {
          resultId: claim.resultId,
          status: "success",
          output: targetResult.output,
          scores,
          passed,
          itemScore,
          ...(targetResult.traceId !== undefined
            ? { traceId: targetResult.traceId }
            : {}),
          latencyMs: Date.now() - startedAt,
        });
      } catch (err) {
        await ctx.runMutation(internal.runner.finalize, {
          resultId: claim.resultId,
          status: "error",
          passed: false,
          itemScore: 0,
          errorType: err instanceof Error ? err.name : "Error",
          latencyMs: Date.now() - startedAt,
        });
      }
    }
  },
});

/**
 * Start an evaluation run: create the run and its pending results, and
 * schedule bounded workers, all in one mutation, so the run row and its
 * workers commit atomically (a run can never exist without its workers
 * having been scheduled). Returns the run id for `runSummary` /
 * `listResults` subscriptions.
 */
export const startRun = mutation({
  args: startRunArgs,
  returns: v.id("eval_runs"),
  handler: async (ctx, args): Promise<Id<"eval_runs">> => {
    const { runId, itemCount } = await insertRunAndResults(ctx, args);
    const requested = args.config.concurrency;
    // Non-finite values (NaN, Infinity) fall back to the default so a
    // bad host input cannot schedule zero workers for a running run.
    const base = Number.isFinite(requested)
      ? Math.floor(requested as number)
      : DEFAULT_RUN_CONCURRENCY;
    const concurrency = Math.min(
      Math.max(base, 1),
      MAX_RUN_CONCURRENCY,
      Math.max(itemCount, 1),
    );
    for (let i = 0; i < concurrency && itemCount > 0; i++) {
      await ctx.scheduler.runAfter(0, internal.runner.worker, { runId });
    }
    return runId;
  },
});

/**
 * The live run summary: the single run row with maintained counters
 * (total / completed / passed) and the running aggregate score.
 * Subscribers see progress as workers finalize items, no polling.
 */
export const runSummary = query({
  args: { runId: v.id("eval_runs") },
  returns: v.union(v.null(), runValidator),
  handler: async (ctx, args): Promise<Doc<"eval_runs"> | null> => {
    return await ctx.db.get("eval_runs", args.runId);
  },
});

/** One result row per item of a run. */
export const listResults = query({
  args: { runId: v.id("eval_runs") },
  returns: v.array(resultValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eval_results")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});
