#!/usr/bin/env node
/* global console, process */

/**
 * Backend-level proof for the Phase 3 scorers: a run wiring exactMatch,
 * a 3-judge consensus panel, and embeddingSimilarity completes live,
 * every result carries all three score records, and the judges'
 * verdicts appear as `judge` spans inside each item's trace.
 *
 * Run against the local backend (started via `pnpm local:start`) after
 * deploying the example (`npx convex dev --once`):
 *
 *     node example/judge-proof.mjs
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
  const datasetId = await client.action(api.evalDemo.seedDemoDataset, {});
  const runId = await client.action(api.evalDemo.startJudgeRun, { datasetId });
  console.log(`started judge run ${runId}`);

  // Wait for completion via the live summary subscription.
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
  await Promise.race([
    new Promise((resolve) => {
      const check = () => {
        if (latest?.status === "completed") resolve();
        else notify = check;
      };
      check();
    }),
    deadline(20_000, "run completion"),
  ]);
  unsubscribe();
  console.log(
    `run completed: ${latest.passedCount}/${latest.itemCount} passed, ` +
      `summaryScore=${latest.summaryScore.toFixed(2)}`,
  );

  // The uppercase-mismatch item ("convex") fails exactMatch AND the
  // case-sensitive stub embedder; the two matching items pass all three.
  if (latest.itemCount !== 3 || latest.passedCount !== 2) {
    throw new Error(
      `expected 2/3 passed, got ${latest.passedCount}/${latest.itemCount}`,
    );
  }

  const results = await client.query(api.evalDemo.listRunResults, { runId });
  for (const result of results) {
    if (result.status !== "success") {
      throw new Error(`result ${result._id} status ${result.status}`);
    }
    const names = result.scores.map((s) => s.scorer).sort();
    if (
      JSON.stringify(names) !==
      JSON.stringify(["embeddingSimilarity", "exactMatch", "panel"])
    ) {
      throw new Error(`unexpected score records: ${names.join(", ")}`);
    }
    const panel = result.scores.find((s) => s.scorer === "panel");
    if (!panel.passed || panel.details.votes.length !== 3) {
      throw new Error("consensus panel did not pass with 3 votes");
    }

    // Judge spans in the item's trace, run-stamped.
    const spans = await client.query(api.demo.listSpans, {
      traceId: result.traceId,
    });
    const judgeSpans = spans.filter(
      (s) => s.kind === "judge" && s.runId === runId,
    );
    if (judgeSpans.length !== 3) {
      throw new Error(
        `expected 3 judge spans in trace ${result.traceId}, got ${judgeSpans.length}`,
      );
    }
  }
  console.log(
    "all results carry exactMatch + panel + embeddingSimilarity records; " +
      "3 run-stamped judge spans per item trace",
  );

  console.log("PASS: judges, consensus, and embeddingSimilarity work end to end");
  await client.close();
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err.message);
  await client.close();
  process.exit(1);
}
