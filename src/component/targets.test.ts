/**
 * Test-only target actions for the runner tests. Lives in a `.test.ts`
 * file so Convex codegen and the published package ignore it, while the
 * `import.meta.glob` module map in `setup.test.ts` still picks it up as
 * a callable module under convex-test.
 */
import { createFunctionHandle, anyApi } from "convex/server";
import { v } from "convex/values";
import { test } from "vitest";

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

/** Resolve the `respond` action to a function handle, test-side. */
export const makeRespondHandle = action({
  args: {},
  returns: v.string(),
  handler: async () => {
    return await createFunctionHandle(
      (anyApi as never as Record<string, { respond: never }>)["targets.test"]
        .respond,
    );
  },
});
