import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { INLINE_CONTENT_THRESHOLD_BYTES } from "../shared.js";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
// Load the test target module so its client-wrapper actions register.
import "./targets.test.js";

const targetsTest = (anyApi as never as Record<string, Record<string, never>>)[
  "targets.test"
];

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

describe("trace retention pruning", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_000_000_000_000;

  test("spans older than the cutoff are deleted, newer ones kept", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);

    await t.mutation(
      api.ingestion.recordSpan,
      baseSpan({ spanId: "old", startedAt: NOW - 40 * DAY }),
    );
    await t.mutation(
      api.ingestion.recordSpan,
      baseSpan({ spanId: "fresh", startedAt: NOW - 1 * DAY }),
    );

    // Default 30-day retention: the 40-day span goes, the 1-day stays.
    const outcome = await t.mutation(api.ingestion.pruneTraces, {});
    expect(outcome).toEqual({ deleted: 1, hasMore: false });

    const rows = await t.run((ctx) => ctx.db.query("eval_traces").collect());
    expect(rows.map((r) => r.spanId)).toEqual(["fresh"]);
  });

  test("a pruned span's File Storage content is deleted, not orphaned", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);

    const big = "x".repeat(INLINE_CONTENT_THRESHOLD_BYTES + 1);
    // Both input and output offloaded, so both storage ids must cascade.
    await t.action(
      api.ingestion.recordSpanWithContent,
      baseSpan({
        spanId: "old",
        startedAt: NOW - 40 * DAY,
        input: big,
        output: big,
      }),
    );
    let files = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect(),
    );
    expect(files).toHaveLength(2);

    const outcome = await t.mutation(api.ingestion.pruneTraces, {
      olderThanMs: 30 * DAY,
    });
    expect(outcome.deleted).toBe(1);

    // Both the row and its offloaded blob are gone.
    const rows = await t.run((ctx) => ctx.db.query("eval_traces").collect());
    expect(rows).toHaveLength(0);
    files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(files).toHaveLength(0);
  });

  test("hasMore drives the loop until the backlog is drained", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);

    for (let i = 0; i < 3; i++) {
      await t.mutation(
        api.ingestion.recordSpan,
        baseSpan({ spanId: `old-${i}`, startedAt: NOW - (40 + i) * DAY }),
      );
    }

    const first = await t.mutation(api.ingestion.pruneTraces, { limit: 2 });
    expect(first).toEqual({ deleted: 2, hasMore: true });
    const second = await t.mutation(api.ingestion.pruneTraces, { limit: 2 });
    expect(second).toEqual({ deleted: 1, hasMore: false });

    const rows = await t.run((ctx) => ctx.db.query("eval_traces").collect());
    expect(rows).toHaveLength(0);
  });

  test("a non-finite age falls back to the default and spares fresh spans", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);

    await t.mutation(
      api.ingestion.recordSpan,
      baseSpan({ spanId: "fresh", startedAt: NOW - 1 * DAY }),
    );

    // NaN must not widen the window to "now" and delete everything.
    const outcome = await t.mutation(api.ingestion.pruneTraces, {
      olderThanMs: NaN,
    });
    expect(outcome).toEqual({ deleted: 0, hasMore: false });
    const rows = await t.run((ctx) => ctx.db.query("eval_traces").collect());
    expect(rows).toHaveLength(1);
  });

  test("the pruneTraces client wrapper reaches the component", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);

    await t.mutation(
      api.ingestion.recordSpan,
      baseSpan({ spanId: "old", startedAt: NOW - 40 * DAY }),
    );

    const outcome = (await t.action(
      targetsTest.clientPruneTraces as never,
      { olderThanMs: 30 * DAY } as never,
    )) as { deleted: number; hasMore: boolean };
    expect(outcome).toEqual({ deleted: 1, hasMore: false });
    const rows = await t.run((ctx) => ctx.db.query("eval_traces").collect());
    expect(rows).toHaveLength(0);
  });
});
