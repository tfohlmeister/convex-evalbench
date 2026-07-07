import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
// Evaluate the targets module at collection time; convex-test's lazy
// import then hits the module cache instead of re-running its `test()`
// registration inside a running test.
import "./targets.test.js";

const targetsTest = (anyApi as never as Record<string, never>)[
  "targets.test"
] as unknown as {
  respond: never;
  makeHandle: never;
};

type TestConvexT = ReturnType<typeof convexTest>;

async function makeHandle(t: TestConvexT, name: string): Promise<string> {
  return (await t.action(targetsTest.makeHandle, { name } as never)) as string;
}

const exactMatchConfig = { scorers: [{ type: "exactMatch" as const }] };

async function seedDataset(
  t: ReturnType<typeof convexTest>,
  inputs: { input: unknown; expectedOutput?: unknown }[],
) {
  return await t.mutation(api.datasets.createDataset, {
    name: "runner-ds",
    items: inputs,
  });
}

describe("run storage and the claim seam", () => {
  test("createRun creates one pending result per item", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: 1 }, { input: 2 }]);

    const { runId, itemCount } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle: "unused",
      config: exactMatchConfig,
    });

    expect(itemCount).toBe(2);
    const results = await t.query(api.runner.listResults, { runId });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "pending")).toBe(true);
    expect(results.every((r) => r.attempts === 0)).toBe(true);
  });

  test("claim hands out each item once, then null", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "a" }, { input: "b" }]);
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle: "unused",
      config: exactMatchConfig,
    });

    const first = await t.mutation(internal.runner.claimNext, { runId });
    const second = await t.mutation(internal.runner.claimNext, { runId });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.itemId).not.toBe(second!.itemId);
    expect(first!.targetHandle).toBe("unused");

    // Both rows are claimed; there is nothing left to hand out.
    expect(await t.mutation(internal.runner.claimNext, { runId })).toBeNull();

    const results = await t.query(api.runner.listResults, { runId });
    expect(results.every((r) => r.status === "running")).toBe(true);
    expect(results.every((r) => r.attempts === 1)).toBe(true);
  });

  test("finalize updates counters and completes the run on the last item", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "a" }, { input: "b" }]);
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle: "unused",
      config: exactMatchConfig,
    });

    const first = await t.mutation(internal.runner.claimNext, { runId });
    await t.mutation(internal.runner.finalize, {
      resultId: first!.resultId,
      status: "success",
      output: "a",
      scores: [{ scorer: "exactMatch", score: 1, passed: true }],
      passed: true,
      itemScore: 1,
    });

    // Live progress: the summary reflects the first finalize immediately.
    let summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({
      status: "running",
      completedCount: 1,
      passedCount: 1,
      summaryScore: 1,
    });

    const second = await t.mutation(internal.runner.claimNext, { runId });
    await t.mutation(internal.runner.finalize, {
      resultId: second!.resultId,
      status: "error",
      passed: false,
      itemScore: 0,
      errorType: "Error",
    });

    summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({
      status: "completed",
      completedCount: 2,
      passedCount: 1,
      summaryScore: 0.5,
    });
    expect(summary!.completedAt).toBeDefined();

    // The aggregate item score is stored on each result row (the value
    // folded into the run mean), so compares need no recomputation.
    const results = await t.query(api.runner.listResults, { runId });
    const byItem = Object.fromEntries(results.map((r) => [r.itemId, r]));
    expect(byItem[first!.itemId].itemScore).toBe(1);
    expect(byItem[second!.itemId].itemScore).toBe(0);
  });

  test("terminal results and terminal runs are immutable (re-drive safe)", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "a" }]);
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle: "unused",
      config: exactMatchConfig,
    });

    const claim = await t.mutation(internal.runner.claimNext, { runId });
    await t.mutation(internal.runner.finalize, {
      resultId: claim!.resultId,
      status: "success",
      output: "a",
      scores: [{ scorer: "exactMatch", score: 1, passed: true }],
      passed: true,
      itemScore: 1,
    });

    // Re-driving a completed run hands out nothing...
    expect(await t.mutation(internal.runner.claimNext, { runId })).toBeNull();

    // ...and re-finalizing a terminal result changes neither the result
    // nor the counters.
    await t.mutation(internal.runner.finalize, {
      resultId: claim!.resultId,
      status: "error",
      passed: false,
      itemScore: 0,
      errorType: "Error",
    });
    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({
      status: "completed",
      completedCount: 1,
      passedCount: 1,
    });
    const results = await t.query(api.runner.listResults, { runId });
    expect(results[0]).toMatchObject({ status: "success", passed: true });
  });

  test("startRun on a missing dataset is rejected and creates no run", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: 1 }]);
    await t.run(async (ctx) => {
      const items = await ctx.db.query("eval_dataset_items").collect();
      for (const item of items) {
        await ctx.db.delete("eval_dataset_items", item._id);
      }
      await ctx.db.delete("eval_datasets", datasetId);
    });

    await expect(
      t.mutation(api.runner.startRun, {
        datasetId,
        targetHandle: "unused",
        config: exactMatchConfig,
      }),
    ).rejects.toThrow(/dataset not found/);
    const runs = await t.run(
      async (ctx) => await ctx.db.query("eval_runs").collect(),
    );
    expect(runs).toHaveLength(0);
  });
});

describe("runner execution", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("non-finite concurrency falls back to the default and still runs", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "a", expectedOutput: "a" }]);
    const targetHandle = await makeHandle(t, "respond");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: { scorers: [{ type: "exactMatch" as const }], concurrency: NaN },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({ status: "completed", completedCount: 1 });
  });

  test("a run executes, scores every item, and records trace ids", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [
      { input: "a", expectedOutput: "a" },
      { input: "b", expectedOutput: "b" },
      { input: "c", expectedOutput: "different" },
    ]);
    const targetHandle = await makeHandle(t, "respond");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: {
        scorers: [
          { type: "exactMatch" as const },
          { type: "jsonSchema" as const, schema: { type: "string" } },
        ],
        concurrency: 2,
      },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({
      status: "completed",
      itemCount: 3,
      completedCount: 3,
      // "c" echoes "c", which fails exactMatch against "different".
      passedCount: 2,
    });

    const results = await t.query(api.runner.listResults, { runId });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "success")).toBe(true);
    for (const result of results) {
      expect(result.traceId).toBe(`trace-${result.itemId}`);
      expect(result.scores).toHaveLength(2);
      expect(result.latencyMs).toBeDefined();
    }
    const failed = results.find((r) => r.passed === false);
    expect(failed?.scores).toContainEqual({
      scorer: "exactMatch",
      score: 0,
      passed: false,
    });
    // jsonSchema still passes for the exactMatch-failing item.
    expect(failed?.scores).toContainEqual({
      scorer: "jsonSchema",
      score: 1,
      passed: true,
    });
  });

  test("a throwing target yields an error result; other items complete", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [
      { input: "a", expectedOutput: "a" },
      { input: "boom" },
      { input: "b", expectedOutput: "b" },
    ]);
    const targetHandle = await makeHandle(t, "respond");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: exactMatchConfig,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({
      status: "completed",
      completedCount: 3,
      passedCount: 2,
    });

    const results = await t.query(api.runner.listResults, { runId });
    const errored = results.filter((r) => r.status === "error");
    expect(errored).toHaveLength(1);
    expect(errored[0]).toMatchObject({ passed: false, errorType: "Error" });
    expect(results.filter((r) => r.status === "success")).toHaveLength(2);
  });
});

describe("managed retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a retryable failure below the cap is retried until it succeeds", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "x", expectedOutput: "x" }]);
    const targetHandle = await makeHandle(t, "flaky");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: exactMatchConfig, // maxAttempts default 3
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [result] = await t.query(api.runner.listResults, { runId });
    // flaky throws retryable on attempt 1, succeeds on attempt 2.
    expect(result).toMatchObject({ status: "success", attempts: 2 });
    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({ status: "completed", completedCount: 1 });
  });

  test("a retryable failure at the cap is finalized as an error", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "x" }]);
    const targetHandle = await makeHandle(t, "retryForever");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: { scorers: [], maxAttempts: 3 },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result).toMatchObject({ status: "error", attempts: 3 });
    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({ status: "completed", completedCount: 1 });
  });

  test("a non-retryable failure is finalized on the first attempt", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "boom" }]);
    const targetHandle = await makeHandle(t, "respond");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: { scorers: [], maxAttempts: 3 },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [result] = await t.query(api.runner.listResults, { runId });
    // "boom" throws a plain Error, so no retry: one attempt, then error.
    expect(result).toMatchObject({ status: "error", attempts: 1 });
  });

  test("retryItem re-pends a running result, then a worker reprocesses it", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "ok", expectedOutput: "ok" }]);
    const targetHandle = await makeHandle(t, "respond");
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle,
      config: exactMatchConfig,
    });

    const claim = await t.mutation(internal.runner.claimNext, { runId });
    await t.mutation(internal.runner.retryItem, {
      resultId: claim!.resultId,
      runId,
    });

    // Re-pended immediately; the worker it scheduled has not run yet.
    const [pending] = await t.query(api.runner.listResults, { runId });
    expect(pending).toMatchObject({ status: "pending", attempts: 1 });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [done] = await t.query(api.runner.listResults, { runId });
    expect(done).toMatchObject({ status: "success", attempts: 2 });
  });

  test("retryItem is a no-op on a terminal result", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "a" }]);
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle: "unused",
      config: { scorers: [] },
    });

    const claim = await t.mutation(internal.runner.claimNext, { runId });
    await t.mutation(internal.runner.finalize, {
      resultId: claim!.resultId,
      status: "error",
      passed: false,
      itemScore: 0,
      errorType: "Error",
    });

    await t.mutation(internal.runner.retryItem, {
      resultId: claim!.resultId,
      runId,
    });

    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result).toMatchObject({ status: "error", attempts: 1 });
  });
});

describe("handle-based scorers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function runWithScorers(
    t: TestConvexT,
    items: { input: unknown; expectedOutput?: unknown }[],
    scorers: unknown[],
  ) {
    const datasetId = await seedDataset(t, items);
    const targetHandle = await makeHandle(t, "respond");
    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: { scorers } as never,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return runId;
  }

  test("a defineScorer-built scorer receives the contract and lands its verdict", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const scorerHandle = await makeHandle(t, "lengthScorer");

    const runId = await runWithScorers(
      t,
      [{ input: "hi", expectedOutput: "hi" }],
      [
        { type: "custom", name: "length", handle: scorerHandle, config: { note: "x" } },
      ],
    );

    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result.status).toBe("success");
    expect(result.passed).toBe(true);
    expect(result.scores).toHaveLength(1);
    const record = result.scores![0];
    expect(record).toMatchObject({ scorer: "length", score: 1, passed: true });
    // The full contract arrived at the scorer action.
    expect(record.details).toMatchObject({
      runId,
      itemId: result.itemId,
      config: { note: "x" },
    });
  });

  test("throwing and shape-broken scorers fail their record, not the item", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const good = await makeHandle(t, "lengthScorer");
    const throwing = await makeHandle(t, "throwingScorer");
    const broken = await makeHandle(t, "brokenScorer");

    const runId = await runWithScorers(
      t,
      [{ input: "hi", expectedOutput: "hi" }],
      [
        { type: "custom", name: "good", handle: good },
        { type: "custom", name: "throwing", handle: throwing },
        { type: "custom", name: "broken", handle: broken },
      ],
    );

    const [result] = await t.query(api.runner.listResults, { runId });
    // The item itself succeeded; only the records reflect the failures.
    expect(result.status).toBe("success");
    expect(result.output).toBe("hi");
    expect(result.passed).toBe(false);
    const byName = Object.fromEntries(
      result.scores!.map((s) => [s.scorer, s]),
    );
    expect(byName.good).toMatchObject({ score: 1, passed: true });
    expect(byName.throwing.passed).toBe(false);
    expect((byName.throwing.details as { error: string }).error).toMatch(
      /scorer exploded/,
    );
    // The defineScorer returns-validator rejects the broken shape.
    expect(byName.broken.passed).toBe(false);
    expect((byName.broken.details as { error: string }).error).toBeTruthy();
  });

  test("embeddingSimilarity passes, fails, and degrades gracefully", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const embedderHandle = await makeHandle(t, "embedder");

    const runId = await runWithScorers(
      t,
      [
        { input: "alpha", expectedOutput: "apple" }, // same prefix -> identical vectors
        { input: "beta", expectedOutput: "apple" }, // orthogonal vectors
        { input: "gamma" }, // no expectedOutput
      ],
      [{ type: "embeddingSimilarity", embedderHandle, threshold: 0.8 }],
    );

    const results = await t.query(api.runner.listResults, { runId });
    const byInput = new Map(
      await Promise.all(
        results.map(async (r) => {
          const items = await t.query(api.datasets.listItems, {
            datasetId: (await t.query(api.runner.runSummary, { runId }))!
              .datasetId,
          });
          return [
            items.find((i) => i._id === r.itemId)!.input as string,
            r,
          ] as const;
        }),
      ),
    );

    expect(byInput.get("alpha")!.scores![0]).toMatchObject({
      scorer: "embeddingSimilarity",
      passed: true,
    });
    expect(byInput.get("beta")!.scores![0]).toMatchObject({
      scorer: "embeddingSimilarity",
      score: 0,
      passed: false,
    });
    const graceful = byInput.get("gamma")!.scores![0];
    expect(graceful.passed).toBe(false);
    expect((graceful.details as { reason: string }).reason).toMatch(
      /no expectedOutput/,
    );
  });

  test("consensus: majority passes, throwing judge counts as failed vote", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const pass = await makeHandle(t, "judgePass");
    const fail = await makeHandle(t, "judgeFail");
    const throwing = await makeHandle(t, "judgeThrow");

    const runId = await runWithScorers(
      t,
      [{ input: "a", expectedOutput: "a" }],
      [
        { type: "consensus", name: "panel", judgeHandles: [pass, pass, fail] },
        { type: "consensus", judgeHandles: [pass, pass, throwing] },
      ],
    );

    const [result] = await t.query(api.runner.listResults, { runId });
    const byName = Object.fromEntries(
      result.scores!.map((s) => [s.scorer, s]),
    );

    // 2/3 pass with default quorum 2: passing, mean score.
    expect(byName.panel.passed).toBe(true);
    expect(byName.panel.score).toBeCloseTo((0.9 + 0.9 + 0.2) / 3);
    expect(
      (byName.panel.details as { votes: unknown[]; passCount: number })
        .passCount,
    ).toBe(2);

    // The throwing judge is a failed vote; quorum still reached.
    const consensus = byName.consensus;
    expect(consensus.passed).toBe(true);
    const votes = (
      consensus.details as { votes: { details?: { error?: string } }[] }
    ).votes;
    expect(votes).toHaveLength(3);
    expect(votes[2].details?.error).toMatch(/judge exploded/);
  });
});

describe("llmAsJudge span recording", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a judge verdict lands as a judge span in the item's trace", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [
      { input: "hello", expectedOutput: "hello" },
    ]);
    const targetHandle = await makeHandle(t, "respond");
    const judgeHandle = await makeHandle(t, "llmJudge");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: {
        scorers: [{ type: "custom" as const, name: "polite", handle: judgeHandle }],
      },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result.scores![0]).toMatchObject({
      scorer: "polite",
      score: 0.9,
      passed: true,
      details: { reasoning: "canned" },
    });

    // The judge span is in the item's trace, run-stamped.
    const spans = await t.query(api.queries.spansByTrace, {
      traceId: result.traceId!,
    });
    const judgeSpan = spans.find((s) => s.kind === "judge");
    expect(judgeSpan).toBeDefined();
    expect(judgeSpan).toMatchObject({
      operationName: "polite-judge",
      runId,
      status: "success",
    });
  });
});

describe("stuck-row re-drive", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a stuck item is re-driven to completion", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [
      { input: "a", expectedOutput: "a" },
    ]);
    const targetHandle = await makeHandle(t, "respond");
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle,
      config: { scorers: [{ type: "exactMatch" as const }] },
    });

    // Simulate a crashed worker: claim the row, then never finalize.
    const claim = await t.mutation(internal.runner.claimNext, { runId });
    expect(claim).not.toBeNull();

    // olderThanMs 0 treats any claimed row as stuck (frozen fake time).
    const outcome = await t.mutation(api.runner.redriveRun, {
      runId,
      olderThanMs: 0,
    });
    expect(outcome).toEqual({ repended: 1, erroredOut: 0 });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({
      status: "completed",
      completedCount: 1,
      passedCount: 1,
    });
    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result).toMatchObject({ status: "success", attempts: 2 });
  });

  test("the attempts cap converts a stuck item into an error", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "a" }]);
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle: "unused",
      config: { scorers: [], maxAttempts: 1 },
    });

    await t.mutation(internal.runner.claimNext, { runId }); // attempts -> 1

    const outcome = await t.mutation(api.runner.redriveRun, {
      runId,
      olderThanMs: 0,
    });
    expect(outcome).toEqual({ repended: 0, erroredOut: 1 });

    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({
      status: "completed",
      completedCount: 1,
      passedCount: 0,
    });
    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result).toMatchObject({
      status: "error",
      errorType: "max_attempts",
    });
  });

  test("re-drive leaves fresh and terminal results alone", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "a" }, { input: "b" }]);
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle: "unused",
      config: { scorers: [] },
    });

    // One terminal result, one freshly claimed (claimedAt = now).
    const first = await t.mutation(internal.runner.claimNext, { runId });
    await t.mutation(internal.runner.finalize, {
      resultId: first!.resultId,
      status: "success",
      output: "a",
      passed: true,
      itemScore: 1,
    });
    await t.mutation(internal.runner.claimNext, { runId });

    // Default 10-minute cutoff: the fresh claim is not stuck.
    const outcome = await t.mutation(api.runner.redriveRun, { runId });
    expect(outcome).toEqual({ repended: 0, erroredOut: 0 });

    const results = await t.query(api.runner.listResults, { runId });
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(["running", "success"]);
    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({ completedCount: 1, passedCount: 1 });
  });
});

describe("client layer (Evalbench methods)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("startRun resolves scorer references to handles and the run executes", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [
      { input: "alpha", expectedOutput: "alpha" },
    ]);

    const runId = (await t.action(
      (targetsTest as Record<string, never>).clientStartRun,
      { datasetId } as never,
    )) as Id<"eval_runs">;
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The stored config carries resolved handle strings, not refs.
    const summary = await t.query(api.runner.runSummary, { runId });
    const scorers = (summary!.config as {
      scorers: Record<string, unknown>[];
    }).scorers;
    expect(typeof scorers[0].handle).toBe("string");
    expect(typeof scorers[1].embedderHandle).toBe("string");
    expect((scorers[2].judgeHandles as string[])).toHaveLength(3);
    expect(summary).toMatchObject({ status: "completed", completedCount: 1 });

    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result.scores!.map((s) => s.scorer).sort()).toEqual([
      "consensus",
      "embeddingSimilarity",
      "length",
    ]);

    // The redriveRun client wrapper reaches the component (completed
    // run: nothing to do).
    const outcome = await t.action(
      (targetsTest as Record<string, never>).clientRedrive,
      { runId } as never,
    );
    expect(outcome).toEqual({ repended: 0, erroredOut: 0 });
  });
});

describe("review regression cases", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a judge span lands in a fresh trace when the target returns none", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "hello" }]);
    const targetHandle = await makeHandle(t, "respondPlain");
    const judgeHandle = await makeHandle(t, "llmJudge");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: {
        scorers: [
          { type: "custom" as const, name: "polite", handle: judgeHandle },
        ],
      },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result.traceId).toBeUndefined();
    const judgeSpans = await t.run(async (ctx) => {
      const spans = await ctx.db.query("eval_traces").collect();
      return spans.filter((s) => s.kind === "judge" && s.runId === runId);
    });
    expect(judgeSpans).toHaveLength(1);
    expect(judgeSpans[0].traceId).toBeTruthy();
  });

  test("quorum 0 falls back to strict majority instead of always passing", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [{ input: "a" }]);
    const targetHandle = await makeHandle(t, "respond");
    const fail = await makeHandle(t, "judgeFail");

    const runId = await t.mutation(api.runner.startRun, {
      datasetId,
      targetHandle,
      config: {
        scorers: [
          {
            type: "consensus" as const,
            judgeHandles: [fail, fail, fail],
            quorum: 0,
          },
        ],
      },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [result] = await t.query(api.runner.listResults, { runId });
    expect(result.scores![0].passed).toBe(false);
    expect(
      (result.scores![0].details as { quorum: number }).quorum,
    ).toBe(2);
  });

  test("redrive recovers a run with orphaned pending rows (no stuck running row)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, [
      { input: "a", expectedOutput: "a" },
    ]);
    const targetHandle = await makeHandle(t, "respond");
    // createRun without startRun: the run exists, no worker was ever
    // scheduled (the crashed-between-items shape).
    const { runId } = await t.mutation(internal.runner.createRun, {
      datasetId,
      targetHandle,
      config: { scorers: [{ type: "exactMatch" as const }] },
    });

    const outcome = await t.mutation(api.runner.redriveRun, { runId });
    expect(outcome).toEqual({ repended: 0, erroredOut: 0 });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const summary = await t.query(api.runner.runSummary, { runId });
    expect(summary).toMatchObject({
      status: "completed",
      completedCount: 1,
      passedCount: 1,
    });
  });
});
