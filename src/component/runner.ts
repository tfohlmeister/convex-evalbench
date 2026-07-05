import type { FunctionHandle } from "convex/server";
import { ConvexError, v } from "convex/values";

import {
  embeddingInputsInvalid,
  embeddingSimilarity,
  exactMatch,
  jsonSchema,
} from "../scorers.js";
import type {
  RunConfig,
  ScoreRecord,
  ScorerHandleArgs,
  ScorerHandleVerdict,
} from "../shared.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_REDRIVE_CUTOFF_MS,
  DEFAULT_RUN_CONCURRENCY,
  DEFAULT_SIMILARITY_THRESHOLD,
  MAX_RUN_CONCURRENCY,
  runConfigValidator,
  runStatusValidator,
  scoreRecordValidator,
} from "../shared.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { ActionCtx, MutationCtx } from "./_generated/server.js";
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

export const runValidator = v.object({
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
  claimedAt: v.optional(v.number()),
  output: v.optional(v.any()),
  scores: v.optional(v.array(scoreRecordValidator)),
  passed: v.optional(v.boolean()),
  itemScore: v.optional(v.number()),
  traceId: v.optional(v.string()),
  latencyMs: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  errorType: v.optional(v.string()),
  attempts: v.number(),
});

/**
 * Score one output with the deterministic (in-component) scorers of a
 * run config. Handle-based entries (`custom`, `embeddingSimilarity`,
 * `consensus`) are invoked separately by the worker; their records are
 * merged with these before `combineScores`.
 */
export function scoreDeterministic(
  config: RunConfig,
  output: unknown,
  expectedOutput: unknown,
): ScoreRecord[] {
  const scores: ScoreRecord[] = [];
  for (const scorer of config.scorers) {
    if (scorer.type === "exactMatch") {
      const verdict = exactMatch({ output, expectedOutput });
      scores.push({ scorer: scorer.type, ...verdict });
    } else if (scorer.type === "jsonSchema") {
      const verdict = jsonSchema(
        { output },
        scorer.schema as Record<string, unknown>,
      );
      scores.push({
        scorer: scorer.type,
        score: verdict.score,
        passed: verdict.passed,
        ...(verdict.details !== undefined ? { details: verdict.details } : {}),
      });
    }
  }
  return scores;
}

/** A scorer-action handle, as stored in the run config. */
type ScorerHandle = FunctionHandle<
  "action",
  ScorerHandleArgs,
  ScorerHandleVerdict
>;

/** An embedder-action handle: texts in, one vector per text. */
type EmbedderHandle = FunctionHandle<
  "action",
  { texts: string[] },
  number[][]
>;

function failedRecord(name: string, error: unknown): ScoreRecord {
  return {
    scorer: name,
    score: 0,
    passed: false,
    details: { error: error instanceof Error ? error.message : String(error) },
  };
}

/**
 * Defensive shape check on a handle scorer's verdict. The action's
 * `returns` validator is the primary gate, but `v.number()` admits
 * NaN/Infinity and a malformed verdict must degrade to a failed score
 * record, never propagate into `finalize` (where it would error the
 * whole item).
 */
function sanitizeVerdict(name: string, verdict: unknown): ScoreRecord {
  const candidate = verdict as Partial<ScorerHandleVerdict> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof candidate.score !== "number" ||
    !Number.isFinite(candidate.score) ||
    typeof candidate.passed !== "boolean"
  ) {
    return failedRecord(name, new Error("scorer returned an invalid verdict"));
  }
  return {
    scorer: name,
    score: Math.max(0, Math.min(1, candidate.score)),
    passed: candidate.passed,
    ...(candidate.details !== undefined ? { details: candidate.details } : {}),
  };
}

/**
 * Invoke the handle-based scorers of a run config for one item. A
 * throwing scorer yields a failing score record with the error in its
 * details, never an error result: the target succeeded, so the output
 * and the other scorers' records are still worth keeping. Consensus
 * panels fan out their judges in parallel; a throwing judge counts as
 * a failed vote.
 */
/** A positive-integer config value, or its default when non-finite,
 * non-positive, or absent (a bad host value must not disable a guard). */
function sanePositiveInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) >= 1
    ? Math.floor(value as number)
    : fallback;
}

export async function scoreWithHandles(
  ctx: ActionCtx,
  config: RunConfig,
  scorerArgs: ScorerHandleArgs,
): Promise<ScoreRecord[]> {
  // All handle-based scorers of an item run in parallel; each entry
  // isolates its own errors, and the mapped array keeps record order
  // deterministic.
  const records = await Promise.all(
    config.scorers.map(async (scorer): Promise<ScoreRecord | null> => {
      if (scorer.type === "custom") {
        try {
          const verdict = await ctx.runAction(scorer.handle as ScorerHandle, {
            ...scorerArgs,
            ...(scorer.config !== undefined ? { config: scorer.config } : {}),
          });
          return sanitizeVerdict(scorer.name, verdict);
        } catch (err) {
          return failedRecord(scorer.name, err);
        }
      }
      if (scorer.type === "embeddingSimilarity") {
        const invalid = embeddingInputsInvalid(
          scorerArgs.output,
          scorerArgs.expectedOutput,
        );
        if (invalid) return { scorer: scorer.type, ...invalid };
        try {
          const [outputVec, expectedVec] = await ctx.runAction(
            scorer.embedderHandle as EmbedderHandle,
            {
              texts: [
                scorerArgs.output as string,
                scorerArgs.expectedOutput as string,
              ],
            },
          );
          const threshold = Number.isFinite(scorer.threshold)
            ? (scorer.threshold as number)
            : DEFAULT_SIMILARITY_THRESHOLD;
          const verdict = embeddingSimilarity(
            outputVec ?? [],
            expectedVec ?? [],
            threshold,
          );
          return { scorer: scorer.type, ...verdict };
        } catch (err) {
          return failedRecord(scorer.type, err);
        }
      }
      if (scorer.type === "consensus") {
        const name = scorer.name ?? "consensus";
        const votes = await Promise.all(
          scorer.judgeHandles.map(async (handle, index) => {
            try {
              const verdict = await ctx.runAction(
                handle as ScorerHandle,
                scorerArgs,
              );
              const { scorer: _name, ...vote } = sanitizeVerdict(
                `judge-${index}`,
                verdict,
              );
              void _name;
              return { judge: index, ...vote };
            } catch (err) {
              return {
                judge: index,
                score: 0,
                passed: false,
                details: {
                  error: err instanceof Error ? err.message : String(err),
                },
              };
            }
          }),
        );
        const quorum = sanePositiveInt(
          scorer.quorum,
          Math.floor(scorer.judgeHandles.length / 2) + 1,
        );
        const passCount = votes.filter((vote) => vote.passed).length;
        const score =
          votes.length === 0
            ? 0
            : votes.reduce((sum, vote) => sum + vote.score, 0) / votes.length;
        return {
          scorer: name,
          score,
          passed: passCount >= quorum,
          details: { quorum, passCount, votes },
        };
      }
      return null; // deterministic types are scored in scoreDeterministic
    }),
  );
  return records.filter((record): record is ScoreRecord => record !== null);
}

/**
 * Aggregate all score records of one item. Overall pass: every applied
 * scorer passes (vacuously true when the config selects no scorers).
 * Item score: mean of scorer scores, 1 when there is nothing to score.
 */
export function combineScores(scores: ScoreRecord[]): {
  passed: boolean;
  itemScore: number;
} {
  const passed = scores.every((s) => s.passed);
  const itemScore =
    scores.length === 0
      ? 1
      : scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  return { passed, itemScore };
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
      claimedAt: Date.now(),
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
type TerminalPatch = {
  status: "success" | "error";
  output?: unknown;
  scores?: ScoreRecord[];
  passed: boolean;
  traceId?: string;
  latencyMs?: number;
  errorType?: string;
};

/**
 * Core of finalizing one result: write the terminal state and bump the
 * run counters in the same transaction. No-op when the result is
 * already terminal (at-most-once). Shared by the `finalize` mutation
 * and the re-drive's attempts-cap path.
 */
async function finalizeResult(
  ctx: MutationCtx,
  result: Doc<"eval_results">,
  terminal: TerminalPatch,
  itemScore: number,
): Promise<void> {
  if (result.status === "success" || result.status === "error") return;
  await ctx.db.patch("eval_results", result._id, { ...terminal, itemScore });

  const run = await ctx.db.get("eval_runs", result.runId);
  if (!run) throw new ConvexError(`run not found: ${result.runId}`);
  const completedCount = run.completedCount + 1;
  const summaryScore =
    ((run.summaryScore ?? 0) * run.completedCount + itemScore) /
    completedCount;
  await ctx.db.patch("eval_runs", run._id, {
    completedCount,
    passedCount: run.passedCount + (terminal.passed ? 1 : 0),
    summaryScore,
    ...(completedCount === run.itemCount
      ? { status: "completed" as const, completedAt: Date.now() }
      : {}),
  });
}

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
    const { resultId, itemScore, ...terminal } = args;
    void resultId;
    await finalizeResult(ctx, result, terminal, itemScore);
    return null;
  },
});

/**
 * Host-invoked recovery for a wedged run: results stuck in `running`
 * longer than `olderThanMs` (default 10 minutes) go back to `pending`
 * when below the run's attempts cap, or are finalized as
 * `max_attempts` errors when at it. Schedules a worker (atomically
 * with the state change) whenever claimable work remains, including
 * pending rows orphaned by a dead worker. Fresh `running` rows and
 * terminal rows are never touched; a non-`running` run is a no-op.
 */
export const redriveRun = mutation({
  args: {
    runId: v.id("eval_runs"),
    olderThanMs: v.optional(v.number()),
  },
  returns: v.object({ repended: v.number(), erroredOut: v.number() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("eval_runs", args.runId);
    if (!run) throw new ConvexError(`run not found: ${args.runId}`);
    if (run.status !== "running") return { repended: 0, erroredOut: 0 };

    const cutoff =
      Date.now() - (args.olderThanMs ?? DEFAULT_REDRIVE_CUTOFF_MS);
    const maxAttempts = sanePositiveInt(
      (run.config as RunConfig).maxAttempts,
      DEFAULT_MAX_ATTEMPTS,
    );
    const stuck = (
      await ctx.db
        .query("eval_results")
        .withIndex("by_run", (q) =>
          q.eq("runId", args.runId).eq("status", "running"),
        )
        .collect()
    ).filter((result) => (result.claimedAt ?? 0) <= cutoff);

    let repended = 0;
    let erroredOut = 0;
    for (const result of stuck) {
      if (result.attempts >= maxAttempts) {
        await finalizeResult(
          ctx,
          result,
          { status: "error", passed: false, errorType: "max_attempts" },
          0,
        );
        erroredOut++;
      } else {
        await ctx.db.patch("eval_results", result._id, { status: "pending" });
        repended++;
      }
    }
    // Schedule a worker when any work is claimable: re-pended rows, or
    // pending rows orphaned by a worker that died between finalizing
    // one item and claiming the next (those never show up as stuck).
    const hasPending =
      repended > 0 ||
      (await ctx.db
        .query("eval_results")
        .withIndex("by_run", (q) =>
          q.eq("runId", args.runId).eq("status", "pending"),
        )
        .first()) !== null;
    if (hasPending) {
      await ctx.scheduler.runAfter(0, internal.runner.worker, {
        runId: args.runId,
      });
    }
    return { repended, erroredOut };
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
        const scores = [
          ...scoreDeterministic(
            config,
            targetResult.output,
            claim.expectedOutput,
          ),
          ...(await scoreWithHandles(ctx, config, {
            input: claim.input,
            output: targetResult.output,
            ...(claim.expectedOutput !== undefined
              ? { expectedOutput: claim.expectedOutput }
              : {}),
            runId: args.runId,
            itemId: claim.itemId,
            ...(targetResult.traceId !== undefined
              ? { traceId: targetResult.traceId }
              : {}),
          })),
        ];
        const { passed, itemScore } = combineScores(scores);
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
