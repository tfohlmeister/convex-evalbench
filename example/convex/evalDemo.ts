import { Evalbench, defineScorer, llmAsJudge } from "convex-evalbench";
import { v } from "convex/values";

import { api, components } from "./_generated/api.js";
import { action, query } from "./_generated/server.js";

const evalbench = new Evalbench(components.evalbench);

/**
 * The system under test for the eval demo: a deterministic stub standing
 * in for an agent. It uppercases the input, records one `agent_step`
 * span stamped with the `runId` (so the run's traces correlate), and
 * returns the span's `traceId` for the result row.
 */
export const demoTarget = action({
  args: { input: v.any(), runId: v.string(), itemId: v.string() },
  returns: v.object({ output: v.any(), traceId: v.string() }),
  handler: async (ctx, args) => {
    const traceId = crypto.randomUUID();
    const startedAt = Date.now();
    const output =
      typeof args.input === "string" ? args.input.toUpperCase() : args.input;
    await evalbench.recordSpan(ctx, {
      traceId,
      spanId: crypto.randomUUID(),
      runId: args.runId,
      kind: "agent_step",
      operationName: "eval demo target",
      status: "success",
      startedAt,
      endedAt: Date.now(),
    });
    return { output, traceId };
  },
});

/**
 * Seed a small demo dataset: three items with expected outputs, one of
 * which is deliberately wrong so the run shows a failing item.
 */
export const seedDemoDataset = action({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await evalbench.createDataset(ctx, {
      name: "eval-demo",
      description: "uppercase demo dataset",
      items: [
        { input: "hello", expectedOutput: "HELLO" },
        { input: "world", expectedOutput: "WORLD" },
        // Deliberate mismatch: the target uppercases, so this fails.
        { input: "convex", expectedOutput: "convex" },
      ],
    });
  },
});

/** Start an eval run of the demo target over a seeded dataset. */
export const startDemoRun = action({
  args: { datasetId: v.string() },
  returns: v.string(),
  // Explicit return type: the handler references `api.evalDemo.demoTarget`
  // in its own module, which would otherwise be a circular inference.
  handler: async (ctx, args): Promise<string> => {
    return await evalbench.startRun(ctx, {
      datasetId: args.datasetId,
      target: api.evalDemo.demoTarget,
      config: {
        scorers: [{ type: "exactMatch" }],
        concurrency: 2,
      },
      targetVersion: "demo-v1",
      triggeredBy: "eval-proof",
    });
  },
});

/**
 * Deterministic judge stubs: llmAsJudge with a canned `generate`, so
 * the demo needs no API key while still exercising the full judge
 * path, including the `judge` span recorded into the item's trace.
 */
export const judgeApprove = action(
  defineScorer(
    llmAsJudge({
      name: "approving-judge",
      rubric: "The output is a faithful transformation of the input.",
      generate: async () =>
        '{"pass": true, "score": 0.9, "reasoning": "looks right"}',
      evalbench,
    }),
  ),
);

export const judgeReject = action(
  defineScorer(
    llmAsJudge({
      name: "rejecting-judge",
      rubric: "The output is a faithful transformation of the input.",
      generate: async () =>
        '{"pass": false, "score": 0.2, "reasoning": "not convinced"}',
      evalbench,
    }),
  ),
);

/**
 * Deterministic embedder stub: texts starting with an uppercase letter
 * map to [1, 0], everything else to [0, 1]. Case-matching pairs are
 * identical, case-mismatched pairs orthogonal.
 */
export const demoEmbedder = action({
  args: { texts: v.array(v.string()) },
  returns: v.array(v.array(v.number())),
  handler: async (_ctx, args) => {
    return args.texts.map((text) =>
      /^[A-Z]/.test(text) ? [1, 0] : [0, 1],
    );
  },
});

/**
 * A run wiring all three Phase 3 scorer kinds over the demo dataset:
 * exactMatch, a 3-judge consensus panel (2 approve, 1 reject), and
 * embeddingSimilarity against the stub embedder.
 */
export const startJudgeRun = action({
  args: { datasetId: v.string() },
  returns: v.string(),
  // Explicit return type: the handler references api.evalDemo.* in its
  // own module, which would otherwise be a circular inference.
  handler: async (ctx, args): Promise<string> => {
    return await evalbench.startRun(ctx, {
      datasetId: args.datasetId,
      target: api.evalDemo.demoTarget,
      config: {
        scorers: [
          { type: "exactMatch" },
          {
            type: "consensus",
            name: "panel",
            judges: [
              api.evalDemo.judgeApprove,
              api.evalDemo.judgeApprove,
              api.evalDemo.judgeReject,
            ],
          },
          {
            type: "embeddingSimilarity",
            embedder: api.evalDemo.demoEmbedder,
            threshold: 0.8,
          },
        ],
        concurrency: 2,
      },
      targetVersion: "demo-v1-judged",
      triggeredBy: "judge-proof",
    });
  },
});

/** Live run summary (counters fill in as items are scored). */
export const getRunSummary = query({
  args: { runId: v.string() },
  handler: (ctx, args) => evalbench.runSummary(ctx, args.runId),
});

/** Per-item results of a run, with scores and trace ids. */
export const listRunResults = query({
  args: { runId: v.string() },
  handler: (ctx, args) => evalbench.listResults(ctx, args.runId),
});
