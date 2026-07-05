#!/usr/bin/env node
/* global console, process */

/**
 * Backend-level proof that an eval run executes end to end and its
 * summary fills in live over a Convex subscription: seed a dataset,
 * subscribe to `runSummary`, start a run, and assert the completed /
 * passed counters stream in until the run reaches `completed`, with
 * every result scored and linked to a trace.
 *
 * Run against the local backend (started via `pnpm local:start`) after
 * deploying the example (`npx convex dev --once`):
 *
 *     node example/eval-proof.mjs
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

try {
  // 1. Seed the demo dataset (3 items, one deliberately failing).
  const datasetId = await client.action(api.evalDemo.seedDemoDataset, {});
  console.log(`seeded dataset ${datasetId}`);

  // 2. Start the run and subscribe to its live summary.
  const runId = await client.action(api.evalDemo.startDemoRun, { datasetId });
  console.log(`started run ${runId}`);

  const snapshots = [];
  let notify = () => {};
  const unsubscribe = client.onUpdate(
    api.evalDemo.getRunSummary,
    { runId },
    (summary) => {
      if (summary) {
        snapshots.push(`${summary.completedCount}/${summary.itemCount}`);
        notify();
      }
    },
  );

  const waitFor = (predicate, label) =>
    Promise.race([
      new Promise((resolve) => {
        const check = () => {
          if (predicate()) resolve();
          else notify = check;
        };
        check();
      }),
      deadline(15_000, label),
    ]);

  // 3. The summary must reach completed via the subscription alone.
  let final;
  await waitFor(() => {
    final = null;
    return snapshots.at(-1) === "3/3";
  }, "all 3 items completed");
  final = await client.query(api.evalDemo.getRunSummary, { runId });
  console.log(`summary snapshots: ${snapshots.join(" -> ")}`);

  if (final.status !== "completed") {
    throw new Error(`run status is ${final.status}, expected completed`);
  }
  // The target uppercases; "convex" expects lowercase, so 2 of 3 pass.
  if (final.passedCount !== 2) {
    throw new Error(`passedCount is ${final.passedCount}, expected 2`);
  }
  console.log(
    `run completed: ${final.passedCount}/${final.itemCount} passed, ` +
      `summaryScore=${final.summaryScore.toFixed(2)}`,
  );

  // 4. Every result is scored and linked to a trace that exists.
  const results = await client.query(api.evalDemo.listRunResults, { runId });
  if (results.length !== 3) {
    throw new Error(`expected 3 results, got ${results.length}`);
  }
  for (const result of results) {
    if (result.status !== "success") {
      throw new Error(`result ${result._id} status ${result.status}`);
    }
    if (!result.scores || result.scores.length !== 1) {
      throw new Error(`result ${result._id} is not scored`);
    }
    if (!result.traceId) {
      throw new Error(`result ${result._id} has no traceId`);
    }
    const spans = await client.query(api.demo.listSpans, {
      traceId: result.traceId,
    });
    if (spans.length === 0 || spans[0].runId !== runId) {
      throw new Error(`trace ${result.traceId} missing or not run-stamped`);
    }
  }
  console.log("all 3 results scored, trace-linked, and run-stamped");

  unsubscribe();
  console.log("PASS: eval run executed and summarized live");
  await client.close();
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err.message);
  await client.close();
  process.exit(1);
}
