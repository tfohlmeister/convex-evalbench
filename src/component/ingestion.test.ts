import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { INLINE_CONTENT_THRESHOLD_BYTES } from "../shared.js";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";

/** Minimal always-recorded fields for a root span. */
function baseSpan(overrides: Record<string, unknown> = {}) {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    kind: "llm" as const,
    operationName: "generateText",
    status: "success" as const,
    startedAt: 1000,
    ...overrides,
  };
}

describe("ingestion", () => {
  test("metadata-only span: row created, no content", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.ingestion.recordSpan, baseSpan());

    const rows = await t.run((ctx) => ctx.db.query("eval_traces").collect());
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.spanId).toBe("span-1");
    expect(row.input).toBeUndefined();
    expect(row.output).toBeUndefined();
    expect(row.inputStorageId).toBeUndefined();
    expect(row.outputStorageId).toBeUndefined();
    expect(row.contentRecorded).toBe(false);
  });

  test("small content is stored inline", async () => {
    const t = convexTest(schema, modules);
    await t.action(
      api.ingestion.recordSpanWithContent,
      baseSpan({ input: "hello", output: "world" }),
    );

    const row = await t.run(async (ctx) =>
      (await ctx.db.query("eval_traces").collect())[0],
    );
    expect(row.input).toBe("hello");
    expect(row.output).toBe("world");
    expect(row.inputStorageId).toBeUndefined();
    expect(row.outputStorageId).toBeUndefined();
    expect(row.contentRecorded).toBe(true);

    const files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(files).toHaveLength(0);
  });

  test("large content is offloaded to File Storage", async () => {
    const t = convexTest(schema, modules);
    const big = "x".repeat(INLINE_CONTENT_THRESHOLD_BYTES + 1);
    await t.action(
      api.ingestion.recordSpanWithContent,
      baseSpan({ input: big, output: "small" }),
    );

    const row = await t.run(async (ctx) =>
      (await ctx.db.query("eval_traces").collect())[0],
    );
    // Large input offloaded; small output stays inline.
    expect(row.input).toBeUndefined();
    expect(row.inputStorageId).not.toBeUndefined();
    expect(row.output).toBe("small");
    expect(row.outputStorageId).toBeUndefined();
    expect(row.contentRecorded).toBe(true);

    const files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(files).toHaveLength(1);

    // The on-demand content query exposes the blob as a signed URL.
    const content = await t.query(api.queries.spanContent, {
      spanId: row._id,
    });
    expect(content.input).toBeUndefined();
    expect(content.inputUrl).toBeTruthy();
    expect(content.output).toBe("small");
  });

  test("metadata path persists no content even when never offered", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(
      api.ingestion.recordSpan,
      baseSpan({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    );

    const row = await t.run(async (ctx) =>
      (await ctx.db.query("eval_traces").collect())[0],
    );
    expect(row.contentRecorded).toBe(false);
    expect(row.input).toBeUndefined();
    expect(row.output).toBeUndefined();
    expect(row.inputTokens).toBe(10);
    expect(row.totalTokens).toBe(15);
  });
});
