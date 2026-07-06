/**
 * Test-only target actions for the runner tests. Lives in a `.test.ts`
 * file so Convex codegen and the published package ignore it, while the
 * `import.meta.glob` module map in `setup.test.ts` still picks it up as
 * a callable module under convex-test.
 */
import { createFunctionHandle, anyApi } from "convex/server";
import { v } from "convex/values";
import { test } from "vitest";

import { Evalbench } from "../client/index.js";
import type { ComponentApi } from "./_generated/component.js";
import { defineScorer, llmAsJudge } from "../client/scorers.js";
import { api } from "./_generated/api.js";
import { action } from "./_generated/server.js";

// vitest collects *.test.ts files and errors on a suite without tests.
test("targets setup", () => {});

/**
 * Deterministic system under test: echoes the input back as the output
 * and reports a per-item trace id; throws for the input "boom" to
 * exercise the target-failure path.
 */
export const respond = action({
  args: { input: v.any(), runId: v.string(), itemId: v.string() },
  returns: v.object({ output: v.any(), traceId: v.string() }),
  handler: async (_ctx, args) => {
    if (args.input === "boom") {
      throw new Error("target exploded");
    }
    return { output: args.input, traceId: `trace-${args.itemId}` };
  },
});

/**
 * Custom scorer built with `defineScorer`: passes non-empty string
 * outputs and echoes the received identifiers into the details, so
 * tests can assert the full contract arrived.
 */
export const lengthScorer = action(
  defineScorer(async (_ctx, args) => {
    const passed = typeof args.output === "string" && args.output.length > 0;
    return {
      score: passed ? 1 : 0,
      passed,
      details: {
        runId: args.runId,
        itemId: args.itemId,
        ...(args.config !== undefined ? { config: args.config } : {}),
      },
    };
  }),
);

/** Scorer that always throws (failure-isolation tests). */
export const throwingScorer = action(
  defineScorer(async () => {
    throw new Error("scorer exploded");
  }),
);

/** Scorer whose handler violates the verdict shape at runtime; the
 * `returns` validator from `defineScorer` must reject it. */
export const brokenScorer = action(
  defineScorer(async () => {
    return { score: "high", passed: "yes" } as never;
  }),
);

/**
 * Deterministic embedder: texts starting with "a" map to [1, 0],
 * everything else to [0, 1], so same-prefix pairs are identical and
 * mixed pairs are orthogonal.
 */
export const embedder = action({
  args: { texts: v.array(v.string()) },
  returns: v.array(v.array(v.number())),
  handler: async (_ctx, args) => {
    return args.texts.map((text) =>
      text.startsWith("a") ? [1, 0] : [0, 1],
    );
  },
});

/**
 * llmAsJudge with a stubbed `generate`. In these tests the component
 * runs AS the app, so the Evalbench handle points at `api` directly
 * and judge spans land in the local `eval_traces` table.
 */
const evalbench = new Evalbench(api as unknown as ComponentApi);
export const llmJudge = action(
  defineScorer(
    llmAsJudge({
      name: "polite-judge",
      rubric: "The output is polite.",
      generate: async () =>
        '{"pass": true, "score": 0.9, "reasoning": "canned"}',
      evalbench,
    }),
  ),
);

/** Judges with fixed verdicts for consensus tests. */
export const judgePass = action(
  defineScorer(async () => ({ score: 0.9, passed: true })),
);
export const judgeFail = action(
  defineScorer(async () => ({ score: 0.2, passed: false })),
);
export const judgeThrow = action(
  defineScorer(async () => {
    throw new Error("judge exploded");
  }),
);

/** Target that returns no traceId (fresh-trace judge-span fallback). */
export const respondPlain = action({
  args: { input: v.any(), runId: v.string(), itemId: v.string() },
  returns: v.object({ output: v.any() }),
  handler: async (_ctx, args) => {
    return { output: args.input };
  },
});

const targetsModule = (
  anyApi as never as Record<string, Record<string, never>>
)["targets.test"];

/**
 * Exercise the client layer end to end: `Evalbench.startRun` with
 * function REFERENCES (not handles) for all three handle-based scorer
 * kinds, resolved via `createFunctionHandle` inside the client.
 */
export const clientStartRun = action({
  args: { datasetId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    return await evalbench.startRun(ctx, {
      datasetId: args.datasetId,
      target: targetsModule.respond,
      config: {
        scorers: [
          { type: "custom", name: "length", fn: targetsModule.lengthScorer },
          { type: "embeddingSimilarity", embedder: targetsModule.embedder },
          {
            type: "consensus",
            judges: [
              targetsModule.judgePass,
              targetsModule.judgePass,
              targetsModule.judgeFail,
            ],
          },
        ],
        concurrency: 2,
      },
    });
  },
});

/** Exercise the `Evalbench.compareRuns` client wrapper. */
export const clientCompare = action({
  args: { baselineRunId: v.string(), candidateRunId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await evalbench.compareRuns(ctx, args);
  },
});

/** Exercise the `Evalbench.evaluateGate` client wrapper. */
export const clientGate = action({
  args: { baselineRunId: v.string(), candidateRunId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await evalbench.evaluateGate(ctx, args);
  },
});

/** Exercise the `Evalbench.listRuns` client wrapper. */
export const clientListRuns = action({
  args: { datasetId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await evalbench.listRuns(ctx, args);
  },
});

/** Exercise the `Evalbench.pruneTraces` client wrapper. */
export const clientPruneTraces = action({
  args: { olderThanMs: v.optional(v.number()), limit: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    return await evalbench.pruneTraces(ctx, args);
  },
});

/** Exercise the `Evalbench.redriveRun` client wrapper. */
export const clientRedrive = action({
  args: { runId: v.string() },
  returns: v.object({ repended: v.number(), erroredOut: v.number() }),
  handler: async (ctx, args) => {
    return await evalbench.redriveRun(ctx, args.runId, { olderThanMs: 0 });
  },
});

/** Resolve any exported action of this module to a function handle. */
export const makeHandle = action({
  args: { name: v.string() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const module = (anyApi as never as Record<string, Record<string, never>>)[
      "targets.test"
    ];
    return await createFunctionHandle(module[args.name]);
  },
});
