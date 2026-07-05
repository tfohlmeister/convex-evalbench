import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api.js";
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
  makeRespondHandle: never;
};

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
    const targetHandle = await t.action(targetsTest.makeRespondHandle, {});

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
    const targetHandle = await t.action(targetsTest.makeRespondHandle, {});

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
    const targetHandle = await t.action(targetsTest.makeRespondHandle, {});

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
