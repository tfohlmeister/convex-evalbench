import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import type { SchemaDefinition, GenericSchema } from "convex/server";
import { describe, expect, test } from "vitest";

import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { modules } from "../component/setup.test.js";
import { evalbenchMiddleware } from "./ai.js";
import { Evalbench, type RunActionCtx } from "./index.js";

/**
 * Synthetic host ctx that routes the client's run* calls into convex-test's
 * top-level runners, so the adapter exercises the real component ingestion
 * (mutation, action, File Storage) end to end.
 */
function makeCtx(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
): RunActionCtx {
  return {
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
    runAction: (ref: any, args: any) => t.action(ref, args),
  } as unknown as RunActionCtx;
}

function setup() {
  const t = convexTest(schema, modules);
  const ctx = makeCtx(t);
  const evalbench = new Evalbench(api as never);
  const rows = () => t.run((c) => c.db.query("eval_traces").collect());
  return { t, ctx, evalbench, rows };
}

const model = { modelId: "gpt-4o", provider: "openai" };
const params = { prompt: [{ role: "user", content: "hi" }] };

/** A doGenerate result with the AI SDK v3 nested-usage shape. */
function generateResult(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text", text: "HELLO" }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 10 },
      outputTokens: { total: 20 },
    },
    providerMetadata: { openai: { cachedPromptTokens: 0 } },
    ...overrides,
  };
}

/** A stubbed wrapGenerate args tuple; doStream is unused here. */
function genArgs(doGenerate: () => Promise<any>) {
  return {
    doGenerate,
    doStream: async () => ({ stream: streamOf([]) }),
    params,
    model,
  };
}

function streamOf(parts: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<any>): Promise<any[]> {
  const reader = stream.getReader();
  const seen: any[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen.push(value);
  }
  return seen;
}

describe("evalbenchMiddleware wrapGenerate", () => {
  test("records one llm span with mapped model, usage, and measured latency", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({ evalbench, ctx });

    const out = await mw.wrapGenerate(genArgs(async () => generateResult()));
    expect(out.finishReason.unified).toBe("stop");

    const spans = await rows();
    expect(spans).toHaveLength(1);
    const s = spans[0];
    expect(s.kind).toBe("llm");
    expect(s.model).toBe("gpt-4o");
    expect(s.provider).toBe("openai");
    expect(s.inputTokens).toBe(10);
    expect(s.outputTokens).toBe(20);
    expect(s.totalTokens).toBe(30);
    expect(s.status).toBe("success");
    expect(typeof s.latencyMs).toBe("number");
    expect(s.latencyMs).toBeGreaterThanOrEqual(0);
    expect(s.metadata).toEqual({ openai: { cachedPromptTokens: 0 } });
    // Content off by default.
    expect(s.input).toBeUndefined();
    expect(s.output).toBeUndefined();
  });

  test("records prompt and completion content only when opted in", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({ evalbench, ctx, recordContent: true });

    await mw.wrapGenerate(genArgs(async () => generateResult()));

    const [s] = await rows();
    expect(s.output).toBe("HELLO");
    expect(s.input).toContain("hi");
  });

  test("records an error span and rethrows when the call throws", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({ evalbench, ctx });

    await expect(
      mw.wrapGenerate(
        genArgs(async () => {
          throw new TypeError("boom");
        }),
      ),
    ).rejects.toThrow("boom");

    const [s] = await rows();
    expect(s.status).toBe("error");
    expect(s.errorType).toBe("TypeError");
  });

  test("a finishReason of error records an error span without throwing", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({ evalbench, ctx });

    await mw.wrapGenerate(
      genArgs(async () => generateResult({ finishReason: { unified: "error" } })),
    );

    const [s] = await rows();
    expect(s.status).toBe("error");
  });

  test("honors supplied traceId and runId", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({
      evalbench,
      ctx,
      traceId: "trace-1",
      runId: "run-1",
      parentSpanId: "root-1",
    });

    await mw.wrapGenerate(genArgs(async () => generateResult()));

    const [s] = await rows();
    expect(s.traceId).toBe("trace-1");
    expect(s.runId).toBe("run-1");
    expect(s.parentSpanId).toBe("root-1");
  });

  test("calls through one instance share a traceId", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({ evalbench, ctx });

    await mw.wrapGenerate(genArgs(async () => generateResult()));
    await mw.wrapGenerate(genArgs(async () => generateResult()));

    const spans = await rows();
    expect(spans).toHaveLength(2);
    expect(spans[0].traceId).toBe(spans[1].traceId);
  });
});

describe("evalbenchMiddleware wrapStream", () => {
  test("records one span at stream completion with the finish usage", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({ evalbench, ctx, recordContent: true });

    const parts = [
      { type: "text-delta", id: "1", delta: "HEL" },
      { type: "text-delta", id: "1", delta: "LO" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 5 }, outputTokens: { total: 7 } },
        providerMetadata: { openai: { cachedPromptTokens: 2 } },
      },
    ];

    const res = await mw.wrapStream({
      doStream: async () => ({ stream: streamOf(parts) }),
      doGenerate: async () => generateResult(),
      params,
      model,
    });
    const seen = await drain(res.stream);
    // Parts flow through unchanged.
    expect(seen).toHaveLength(3);

    const spans = await rows();
    expect(spans).toHaveLength(1);
    const s = spans[0];
    expect(s.kind).toBe("llm");
    expect(s.status).toBe("success");
    expect(s.inputTokens).toBe(5);
    expect(s.outputTokens).toBe(7);
    expect(s.totalTokens).toBe(12);
    expect(s.output).toBe("HELLO");
    expect(s.metadata).toEqual({ openai: { cachedPromptTokens: 2 } });
  });

  test("records an error span and rethrows when doStream itself rejects", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({ evalbench, ctx });

    await expect(
      mw.wrapStream({
        doStream: async () => {
          throw new TypeError("stream boom");
        },
        doGenerate: async () => generateResult(),
        params,
        model,
      }),
    ).rejects.toThrow("stream boom");

    const spans = await rows();
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("error");
    expect(spans[0].errorType).toBe("TypeError");
  });

  test("records an error span when the stream emits an error part", async () => {
    const { ctx, evalbench, rows } = setup();
    const mw = evalbenchMiddleware({ evalbench, ctx });

    const parts = [{ type: "error", error: new RangeError("nope") }];
    const res = await mw.wrapStream({
      doStream: async () => ({ stream: streamOf(parts) }),
      doGenerate: async () => generateResult(),
      params,
      model,
    });
    await drain(res.stream);

    const [s] = await rows();
    expect(s.status).toBe("error");
    expect(s.errorType).toBe("RangeError");
  });
});
