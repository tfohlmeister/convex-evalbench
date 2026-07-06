import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import type { SchemaDefinition, GenericSchema } from "convex/server";
import { describe, expect, test } from "vitest";

import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { modules } from "../component/setup.test.js";
import { Evalbench, type RunActionCtx } from "./index.js";
import { mapOtlpSpan, otlpTraceHandler } from "./otlp.js";

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
  return { ctx, evalbench, rows };
}

function attr(key: string, stringValue: string) {
  return { key, value: { stringValue } };
}
function intAttr(key: string, intValue: string) {
  return { key, value: { intValue } };
}

function genAiSpan(overrides: Record<string, unknown> = {}) {
  return {
    traceId: "trace-abc",
    spanId: "span-1",
    name: "chat gpt-4o",
    startTimeUnixNano: "1000000000", // 1000 ms
    endTimeUnixNano: "1500000000", // 1500 ms
    status: { code: 1 },
    attributes: [
      attr("gen_ai.system", "openai"),
      attr("gen_ai.request.model", "gpt-4o"),
      intAttr("gen_ai.usage.input_tokens", "10"),
      intAttr("gen_ai.usage.output_tokens", "20"),
    ],
    ...overrides,
  };
}

function payloadOf(spans: unknown[]) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "svc")] },
        scopeSpans: [{ scope: {}, spans }],
      },
    ],
  };
}

function otlpRequest(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/v1/traces", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("mapOtlpSpan", () => {
  test("maps a GenAI span to an llm span", () => {
    const s = mapOtlpSpan(genAiSpan(), {});
    expect(s.kind).toBe("llm");
    expect(s.provider).toBe("openai");
    expect(s.model).toBe("gpt-4o");
    expect(s.inputTokens).toBe(10);
    expect(s.outputTokens).toBe(20);
    expect(s.totalTokens).toBe(30);
    expect(s.startedAt).toBe(1000);
    expect(s.endedAt).toBe(1500);
    expect(s.latencyMs).toBe(500);
    expect(s.status).toBe("success");
  });

  test("defaults a non-GenAI span to workflow_step", () => {
    const s = mapOtlpSpan(
      {
        traceId: "t",
        spanId: "s",
        name: "db.query",
        startTimeUnixNano: "0",
        attributes: [attr("db.system", "postgres")],
      },
      {},
    );
    expect(s.kind).toBe("workflow_step");
    expect(s.provider).toBeUndefined();
  });

  test("maps an ERROR status to an error span", () => {
    const s = mapOtlpSpan(
      genAiSpan({ status: { code: 2, message: "rate limited" } }),
      {},
    );
    expect(s.status).toBe("error");
    expect(s.errorType).toBe("rate limited");
  });

  test("throws on a span missing required fields", () => {
    expect(() => mapOtlpSpan({}, {})).toThrow();
    expect(() =>
      mapOtlpSpan({ traceId: "t", spanId: "s" }, {}),
    ).toThrow(/startTimeUnixNano/);
  });
});

describe("otlpTraceHandler", () => {
  test("records mapped spans and returns an empty OTLP response", async () => {
    const { ctx, evalbench, rows } = setup();
    const handler = otlpTraceHandler({ evalbench });

    const res = await handler(ctx, otlpRequest(payloadOf([genAiSpan()])));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});

    const spans = await rows();
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe("llm");
    expect(spans[0].model).toBe("gpt-4o");
    // Content off by default; resource attrs merged into metadata.
    expect(spans[0].input).toBeUndefined();
    expect(spans[0].metadata).toMatchObject({ "service.name": "svc" });
  });

  test("reports partial success for a malformed span", async () => {
    const { ctx, evalbench, rows } = setup();
    const handler = otlpTraceHandler({ evalbench });

    const res = await handler(
      ctx,
      otlpRequest(payloadOf([genAiSpan(), { spanId: "bad" }])),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      partialSuccess: { rejectedSpans: 1, errorMessage: "1 span(s) rejected" },
    });
    expect(await rows()).toHaveLength(1);
  });

  test("records content when opted in", async () => {
    const { ctx, evalbench, rows } = setup();
    const handler = otlpTraceHandler({ evalbench, recordContent: true });

    const span = genAiSpan({
      attributes: [
        attr("gen_ai.system", "openai"),
        attr("gen_ai.request.model", "gpt-4o"),
        attr("gen_ai.prompt", "say hi"),
        attr("gen_ai.completion", "hi"),
      ],
    });
    await handler(ctx, otlpRequest(payloadOf([span])));

    const [s] = await rows();
    expect(s.input).toBe("say hi");
    expect(s.output).toBe("hi");
  });

  test("does not persist content (even in metadata) when recording is off", async () => {
    const { ctx, evalbench, rows } = setup();
    const handler = otlpTraceHandler({ evalbench });

    const span = genAiSpan({
      attributes: [
        attr("gen_ai.system", "openai"),
        attr("gen_ai.prompt", "secret prompt"),
        attr("gen_ai.completion", "secret completion"),
      ],
    });
    await handler(ctx, otlpRequest(payloadOf([span])));

    const [s] = await rows();
    expect(s.input).toBeUndefined();
    expect(s.output).toBeUndefined();
    expect(s.metadata).not.toHaveProperty("gen_ai.prompt");
    expect(s.metadata).not.toHaveProperty("gen_ai.completion");
    expect(JSON.stringify(s.metadata ?? {})).not.toContain("secret");
  });

  test("refuses protobuf with 415", async () => {
    const { ctx, evalbench } = setup();
    const handler = otlpTraceHandler({ evalbench });
    const res = await handler(
      ctx,
      otlpRequest("<binary>", "application/x-protobuf"),
    );
    expect(res.status).toBe(415);
    expect(await res.text()).toContain("http/json");
  });

  test("rejects an unparseable body with 400", async () => {
    const { ctx, evalbench } = setup();
    const handler = otlpTraceHandler({ evalbench });
    const res = await handler(ctx, otlpRequest("{not json", "application/json"));
    expect(res.status).toBe(400);
  });

  test("rejects a denied request with 401 and records nothing", async () => {
    const { ctx, evalbench, rows } = setup();
    const handler = otlpTraceHandler({ evalbench, authorize: () => false });
    const res = await handler(ctx, otlpRequest(payloadOf([genAiSpan()])));
    expect(res.status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  test("bounds an over-cap export and reports the overflow", async () => {
    const { ctx, evalbench, rows } = setup();
    const handler = otlpTraceHandler({ evalbench, maxSpans: 1 });
    const res = await handler(
      ctx,
      otlpRequest(
        payloadOf([genAiSpan(), genAiSpan({ spanId: "span-2" })]),
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      partialSuccess: { rejectedSpans: 1, errorMessage: "1 span(s) rejected" },
    });
    expect(await rows()).toHaveLength(1);
  });
});
