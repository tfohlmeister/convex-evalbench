#!/usr/bin/env node
/* global console, process */

/**
 * Backend-level proof for run comparison and the CI gate: run a
 * baseline target, an identical rerun, and a deliberately regressed
 * variant over one dataset, then assert that
 *
 *  - the compare classifies the regressed item (baseline passed,
 *    candidate failed) as `regressed`,
 *  - the gate fails against the regressed run and passes against the
 *    identical rerun,
 *  - the `assertGate` action throws for CI on the regressed run and
 *    stays silent on the rerun.
 *
 * Run against the local backend (started via `pnpm local:start`) after
 * deploying the example (`npx convex dev --once`):
 *
 *     node example/compare-proof.mjs
 */

import { ConvexClient } from "convex/browser";

import { api } from "./convex/_generated/api.js";

const URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3312";

function deadline(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms),
  );
}

const client = new ConvexClient(URL);

/** Wait for a run to reach `completed` via its live summary subscription. */
function waitForCompletion(runId, label) {
  let notify = () => {};
  let latest = null;
  const unsubscribe = client.onUpdate(
    api.evalDemo.getRunSummary,
    { runId },
    (summary) => {
      latest = summary;
      notify();
    },
  );
  return Promise.race([
    new Promise((resolve) => {
      const check = () => {
        if (latest?.status === "completed") resolve(latest);
        else notify = check;
      };
      check();
    }),
    deadline(20_000, label),
  ]).finally(unsubscribe);
}

try {
  const datasetId = await client.action(api.evalDemo.seedDemoDataset, {});
  console.log(`seeded dataset ${datasetId}`);

  // Baseline, an identical rerun, and the regressed variant.
  const baselineRunId = await client.action(api.evalDemo.startDemoRun, {
    datasetId,
  });
  const rerunRunId = await client.action(api.evalDemo.startDemoRun, {
    datasetId,
  });
  const regressedRunId = await client.action(api.evalDemo.startRegressedRun, {
    datasetId,
  });
  console.log(
    `runs: baseline=${baselineRunId} rerun=${rerunRunId} ` +
      `regressed=${regressedRunId}`,
  );

  await Promise.all([
    waitForCompletion(baselineRunId, "baseline completion"),
    waitForCompletion(rerunRunId, "rerun completion"),
    waitForCompletion(regressedRunId, "regressed completion"),
  ]);
  console.log("all three runs completed");

  // listRuns locates the runs newest first, all on this dataset.
  const runs = await client.query(api.evalDemo.listDatasetRuns, { datasetId });
  if (runs.length !== 3) {
    throw new Error(`expected 3 runs listed, got ${runs.length}`);
  }
  if (runs[0]._id !== regressedRunId) {
    throw new Error("listRuns did not return the newest run first");
  }

  // 1. Compare baseline vs regressed: exactly one item regressed.
  const cmp = await client.query(api.evalDemo.getComparison, {
    baselineRunId,
    candidateRunId: regressedRunId,
  });
  if (
    cmp.stats.regressed !== 1 ||
    cmp.stats.improved !== 0 ||
    cmp.stats.incomplete !== 0
  ) {
    throw new Error(
      `unexpected compare stats: ${JSON.stringify(cmp.stats)}`,
    );
  }
  const regressed = cmp.items.filter((i) => i.classification === "regressed");
  if (regressed.length !== 1) {
    throw new Error(`expected 1 regressed item, got ${regressed.length}`);
  }
  if (!regressed[0].baselinePassed || regressed[0].candidatePassed) {
    throw new Error("regressed item did not pass baseline then fail candidate");
  }
  console.log(
    `compare: 1 regressed, ${cmp.stats.unchanged} unchanged ` +
      `(scoreDelta ${regressed[0].scoreDelta})`,
  );

  // 2. The gate fails against the regressed run, passes against the rerun.
  const badGate = await client.query(api.evalDemo.getGate, {
    baselineRunId,
    candidateRunId: regressedRunId,
  });
  if (badGate.ok || badGate.reasons.length === 0) {
    throw new Error(`gate should fail on the regressed run: ${JSON.stringify(badGate)}`);
  }
  const goodGate = await client.query(api.evalDemo.getGate, {
    baselineRunId,
    candidateRunId: rerunRunId,
  });
  if (!goodGate.ok || goodGate.reasons.length !== 0) {
    throw new Error(`gate should pass on the identical rerun: ${JSON.stringify(goodGate)}`);
  }
  console.log(`gate: regressed -> "${badGate.reasons.join("; ")}"; rerun -> ok`);

  // 3. assertGate throws for CI on the regression, stays silent on the rerun.
  let threw = false;
  try {
    await client.action(api.evalDemo.assertGate, {
      baselineRunId,
      candidateRunId: regressedRunId,
    });
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error("assertGate did not throw on the regressed run");
  }
  await client.action(api.evalDemo.assertGate, {
    baselineRunId,
    candidateRunId: rerunRunId,
  });
  console.log("assertGate: threw on the regression, passed the rerun");

  console.log("PASS: run compare and the CI gate work end to end");
  await client.close();
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err.message);
  await client.close();
  process.exit(1);
}
