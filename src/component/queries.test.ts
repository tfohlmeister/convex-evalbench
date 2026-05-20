import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";

function span(overrides: Record<string, unknown> = {}) {
  return {
    traceId: "trace-1",
    spanId: "root",
    kind: "agent_step" as const,
    operationName: "run",
    status: "success" as const,
    startedAt: 1000,
    ...overrides,
  };
}

describe("queries", () => {
  test("spansByTrace returns a trace's spans oldest first, metadata only", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.ingestion.recordSpan, span({ spanId: "root" }));
    await t.mutation(
      api.ingestion.recordSpan,
      span({ spanId: "child", parentSpanId: "root", startedAt: 1100 }),
    );
    // A span in a different trace must not leak in.
    await t.mutation(
      api.ingestion.recordSpan,
      span({ traceId: "trace-2", spanId: "other" }),
    );

    const spans = await t.query(api.queries.spansByTrace, {
      traceId: "trace-1",
    });
    expect(spans.map((s) => s.spanId)).toEqual(["root", "child"]);
    // No raw content fields on the summary shape.
    expect("input" in spans[0]).toBe(false);
    expect("output" in spans[0]).toBe(false);
  });

  test("spansByTrace reflects a newly recorded span (live fill-in)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.ingestion.recordSpan, span({ spanId: "root" }));

    let spans = await t.query(api.queries.spansByTrace, { traceId: "trace-1" });
    expect(spans).toHaveLength(1);

    await t.mutation(
      api.ingestion.recordSpan,
      span({ spanId: "child", parentSpanId: "root", startedAt: 1100 }),
    );

    spans = await t.query(api.queries.spansByTrace, { traceId: "trace-1" });
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.spanId)).toEqual(["root", "child"]);
  });

  test("recentTraces lists root spans newest first, limited", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(
      api.ingestion.recordSpan,
      span({ traceId: "t1", spanId: "r1", startedAt: 1000 }),
    );
    await t.mutation(
      api.ingestion.recordSpan,
      span({ traceId: "t2", spanId: "r2", startedAt: 2000 }),
    );
    // A child span (has a parent) must be excluded from recent traces.
    await t.mutation(
      api.ingestion.recordSpan,
      span({ traceId: "t2", spanId: "c2", parentSpanId: "r2", startedAt: 2100 }),
    );

    const roots = await t.query(api.queries.recentTraces, { limit: 10 });
    expect(roots.map((s) => s.spanId)).toEqual(["r2", "r1"]);

    const limited = await t.query(api.queries.recentTraces, { limit: 1 });
    expect(limited.map((s) => s.spanId)).toEqual(["r2"]);
  });

  test("spanContent returns inline content directly", async () => {
    const t = convexTest(schema, modules);
    await t.action(
      api.ingestion.recordSpanWithContent,
      span({ spanId: "root", input: "prompt", output: "completion" }),
    );

    const row = await t.run(async (ctx) =>
      (await ctx.db.query("eval_traces").collect())[0],
    );
    const content = await t.query(api.queries.spanContent, { spanId: row._id });
    expect(content.input).toBe("prompt");
    expect(content.output).toBe("completion");
    expect(content.inputUrl).toBeUndefined();
    expect(content.outputUrl).toBeUndefined();
  });
});
