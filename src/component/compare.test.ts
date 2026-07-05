import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
// Load the test target module so its client-wrapper actions register.
import "./targets.test.js";

const targetsTest = (anyApi as never as Record<string, Record<string, never>>)[
  "targets.test"
];

async function seedDataset(
  t: ReturnType<typeof convexTest>,
  count: number,
): Promise<Id<"eval_datasets">> {
  return await t.mutation(api.datasets.createDataset, {
    name: "compare-ds",
    items: Array.from({ length: count }, (_, i) => ({ input: i })),
  });
}

async function createRun(
  t: ReturnType<typeof convexTest>,
  datasetId: Id<"eval_datasets">,
): Promise<Id<"eval_runs">> {
  const { runId } = await t.mutation(internal.runner.createRun, {
    datasetId,
    targetHandle: "unused",
    config: { scorers: [] },
  });
  return runId;
}

type Outcome = { passed: boolean; itemScore: number; error?: boolean };

/**
 * Finalize the next `outcomes.length` pending items of a run in order.
 * Both runs over one dataset insert their results in the same item
 * order, so the k-th finalized item is the same dataset item in both.
 */
async function finalizeRun(
  t: ReturnType<typeof convexTest>,
  runId: Id<"eval_runs">,
  outcomes: Outcome[],
): Promise<void> {
  for (const o of outcomes) {
    const claim = await t.mutation(internal.runner.claimNext, { runId });
    if (!claim) throw new Error("no pending item to finalize");
    await t.mutation(internal.runner.finalize, {
      resultId: claim.resultId,
      status: o.error ? "error" : "success",
      passed: o.passed,
      itemScore: o.itemScore,
    });
  }
}

describe("compareRuns", () => {
  test("classifies regressed, improved, and unchanged items", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 3);

    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    // item 0: pass -> fail (regressed); item 1: fail -> pass (improved);
    // item 2: pass -> pass (unchanged).
    await finalizeRun(t, baseline, [
      { passed: true, itemScore: 1 },
      { passed: false, itemScore: 0 },
      { passed: true, itemScore: 1 },
    ]);
    await finalizeRun(t, candidate, [
      { passed: false, itemScore: 0 },
      { passed: true, itemScore: 1 },
      { passed: true, itemScore: 1 },
    ]);

    const cmp = await t.query(api.compare.compareRuns, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });

    expect(cmp.stats).toMatchObject({
      total: 3,
      regressed: 1,
      improved: 1,
      unchanged: 1,
      incomplete: 0,
      baselineTerminal: 3,
      candidateTerminal: 3,
      baselinePassed: 2,
      candidatePassed: 2,
    });

    const byClass = Object.fromEntries(
      cmp.items.map((i) => [i.classification, i]),
    );
    expect(byClass.regressed).toMatchObject({
      baselinePassed: true,
      candidatePassed: false,
      scoreDelta: -1,
    });
    expect(byClass.improved).toMatchObject({
      baselinePassed: false,
      candidatePassed: true,
      scoreDelta: 1,
    });
    expect(byClass.unchanged).toMatchObject({ scoreDelta: 0 });
  });

  test("rejects runs of different datasets", async () => {
    const t = convexTest(schema, modules);
    const dsA = await seedDataset(t, 1);
    const dsB = await seedDataset(t, 1);
    const runA = await createRun(t, dsA);
    const runB = await createRun(t, dsB);

    await expect(
      t.query(api.compare.compareRuns, {
        baselineRunId: runA,
        candidateRunId: runB,
      }),
    ).rejects.toThrow(/not comparable/);
  });

  test("an incomplete candidate item becomes terminal after a finalize", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 1);
    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    await finalizeRun(t, baseline, [{ passed: true, itemScore: 1 }]);

    // Candidate has not finalized its item yet: incomplete.
    let cmp = await t.query(api.compare.compareRuns, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });
    expect(cmp.stats).toMatchObject({ incomplete: 1, regressed: 0 });
    expect(cmp.items[0].classification).toBe("incomplete");

    // Finalize it as a failure: the same query now classifies it regressed.
    await finalizeRun(t, candidate, [{ passed: false, itemScore: 0 }]);
    cmp = await t.query(api.compare.compareRuns, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });
    expect(cmp.stats).toMatchObject({ incomplete: 0, regressed: 1 });
    expect(cmp.items[0].classification).toBe("regressed");
  });

  test("an item added to the dataset between runs surfaces as incomplete, not dropped", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 1);

    // Baseline runs over the single-item dataset.
    const baseline = await createRun(t, datasetId);
    await finalizeRun(t, baseline, [{ passed: true, itemScore: 1 }]);

    // The dataset gains an item, then the candidate runs over both.
    await t.mutation(api.datasets.addItems, {
      datasetId,
      items: [{ input: 99 }],
    });
    const candidate = await createRun(t, datasetId);
    await finalizeRun(t, candidate, [
      { passed: true, itemScore: 1 }, // shared item: unchanged
      { passed: false, itemScore: 0 }, // candidate-only item
    ]);

    const cmp = await t.query(api.compare.compareRuns, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });
    // The candidate-only item is not dropped: it counts in the total and
    // is visible (incomplete: no baseline to compare against).
    expect(cmp.stats).toMatchObject({
      total: 2,
      unchanged: 1,
      incomplete: 1,
      baselineTerminal: 1,
      candidateTerminal: 2,
    });
    const extra = cmp.items.find((i) => i.baselineStatus === "missing");
    expect(extra).toMatchObject({
      classification: "incomplete",
      candidatePassed: false,
    });
  });

  test("legacy rows without itemScore fall back to the mean of scores", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 1);
    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    await finalizeRun(t, baseline, [{ passed: true, itemScore: 1 }]);
    await finalizeRun(t, candidate, [{ passed: true, itemScore: 1 }]);

    // Simulate a pre-Phase-4 candidate row: drop the stored itemScore,
    // leaving two scorer records averaging 0.5.
    await t.run(async (ctx) => {
      const [row] = await ctx.db
        .query("eval_results")
        .withIndex("by_run", (q) => q.eq("runId", candidate))
        .collect();
      await ctx.db.patch("eval_results", row._id, {
        itemScore: undefined,
        scores: [
          { scorer: "a", score: 1, passed: true },
          { scorer: "b", score: 0, passed: true },
        ],
      });
    });

    const cmp = await t.query(api.compare.compareRuns, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });
    expect(cmp.items[0].candidateScore).toBe(0.5);
    expect(cmp.stats.candidateMeanScore).toBe(0.5);
  });
});

describe("evaluateGate", () => {
  test("default gate fails on a regression and names the count", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 2);
    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    await finalizeRun(t, baseline, [
      { passed: true, itemScore: 1 },
      { passed: true, itemScore: 1 },
    ]);
    await finalizeRun(t, candidate, [
      { passed: false, itemScore: 0 },
      { passed: true, itemScore: 1 },
    ]);

    const verdict = await t.query(api.compare.evaluateGate, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toMatch(/1 item\(s\) regressed/);
  });

  test("an equal-or-better candidate passes with no reasons", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 2);
    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    await finalizeRun(t, baseline, [
      { passed: true, itemScore: 1 },
      { passed: false, itemScore: 0 },
    ]);
    await finalizeRun(t, candidate, [
      { passed: true, itemScore: 1 },
      { passed: true, itemScore: 1 }, // improved, never a regression
    ]);

    const verdict = await t.query(api.compare.evaluateGate, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });
    expect(verdict).toMatchObject({ ok: true, reasons: [] });
  });

  test("an incomplete candidate fails loud", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 1);
    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    await finalizeRun(t, baseline, [{ passed: true, itemScore: 1 }]);
    // candidate left running (no finalize).

    const verdict = await t.query(api.compare.evaluateGate, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual(["candidate run not completed"]);
  });

  test("minPassRate threshold fails a low candidate pass rate", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 2);
    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    // Baseline already fails both, so candidate failures are not
    // regressions; only the pass-rate threshold can trip.
    await finalizeRun(t, baseline, [
      { passed: false, itemScore: 0 },
      { passed: false, itemScore: 0 },
    ]);
    await finalizeRun(t, candidate, [
      { passed: false, itemScore: 0 },
      { passed: false, itemScore: 0 },
    ]);

    const verdict = await t.query(api.compare.evaluateGate, {
      baselineRunId: baseline,
      candidateRunId: candidate,
      thresholds: { minPassRate: 0.5 },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toMatch(/pass rate/);
  });

  test("maxScoreDrop threshold fails a mean-score drop without regression", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 1);
    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    // Both pass (no regression), but the candidate's item score halves.
    await finalizeRun(t, baseline, [{ passed: true, itemScore: 1 }]);
    await finalizeRun(t, candidate, [{ passed: true, itemScore: 0.5 }]);

    // Default gate passes (no regression, no score threshold).
    const lenient = await t.query(api.compare.evaluateGate, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    });
    expect(lenient.ok).toBe(true);

    const strict = await t.query(api.compare.evaluateGate, {
      baselineRunId: baseline,
      candidateRunId: candidate,
      thresholds: { maxScoreDrop: 0.2 },
    });
    expect(strict.ok).toBe(false);
    expect(strict.reasons[0]).toMatch(/mean score dropped/);
  });
});

describe("listRuns", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("lists a dataset's runs newest first, no cross-dataset leakage", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const dsA = await seedDataset(t, 1);
    const dsB = await seedDataset(t, 1);

    const a1 = await createRun(t, dsA);
    vi.advanceTimersByTime(1000);
    const a2 = await createRun(t, dsA);
    vi.advanceTimersByTime(1000);
    const b1 = await createRun(t, dsB);

    const runsA = await t.query(api.compare.listRuns, { datasetId: dsA });
    expect(runsA.map((r) => r._id)).toEqual([a2, a1]);
    expect(runsA.every((r) => r.datasetId === dsA)).toBe(true);
    expect(runsA.some((r) => r._id === b1)).toBe(false);

    const runsB = await t.query(api.compare.listRuns, { datasetId: dsB });
    expect(runsB.map((r) => r._id)).toEqual([b1]);
  });

  test("caps the limit at 200 and honors a smaller one", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 1);
    const ids: Id<"eval_runs">[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await createRun(t, datasetId));
      vi.advanceTimersByTime(1000);
    }
    const limited = await t.query(api.compare.listRuns, {
      datasetId,
      limit: 2,
    });
    expect(limited.map((r) => r._id)).toEqual([ids[2], ids[1]]);
  });
});

describe("client layer (Evalbench methods)", () => {
  test("compareRuns, evaluateGate, and listRuns reach the component", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await seedDataset(t, 2);
    const baseline = await createRun(t, datasetId);
    const candidate = await createRun(t, datasetId);

    await finalizeRun(t, baseline, [
      { passed: true, itemScore: 1 },
      { passed: true, itemScore: 1 },
    ]);
    await finalizeRun(t, candidate, [
      { passed: false, itemScore: 0 },
      { passed: true, itemScore: 1 },
    ]);

    const cmp = (await t.action(targetsTest.clientCompare as never, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    } as never)) as { stats: { regressed: number } };
    expect(cmp.stats.regressed).toBe(1);

    const verdict = (await t.action(targetsTest.clientGate as never, {
      baselineRunId: baseline,
      candidateRunId: candidate,
    } as never)) as { ok: boolean };
    expect(verdict.ok).toBe(false);

    const runs = (await t.action(targetsTest.clientListRuns as never, {
      datasetId,
    } as never)) as { _id: Id<"eval_runs"> }[];
    expect(runs.map((r) => r._id)).toEqual([candidate, baseline]);
  });
});
