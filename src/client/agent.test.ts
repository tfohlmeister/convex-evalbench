import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import type { SchemaDefinition, GenericSchema } from "convex/server";
import { describe, expect, test } from "vitest";

import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { modules } from "../component/setup.test.js";
import { withEvalbench, type AgentLike } from "./agent.js";
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

const usageArgs = {
  model: "gpt-4o",
  provider: "openai",
  threadId: "thread-1",
  userId: "user-1",
  agentName: "demo",
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
};

describe("withEvalbench", () => {
  test("usage handler maps agent usage onto span fields", async () => {
    const { ctx, evalbench, rows } = setup();
    const agent: AgentLike = { options: { name: "demo" } };
    withEvalbench(agent, { evalbench });

    await agent.options.usageHandler!(ctx, usageArgs);

    const spans = await rows();
    expect(spans).toHaveLength(1);
    const s = spans[0];
    expect(s.kind).toBe("llm");
    expect(s.model).toBe("gpt-4o");
    expect(s.provider).toBe("openai");
    expect(s.inputTokens).toBe(10);
    expect(s.outputTokens).toBe(20);
    expect(s.totalTokens).toBe(30);
    expect(s.threadId).toBe("thread-1");
    expect(s.userId).toBe("user-1");
    expect(s.agentName).toBe("demo");
    // No raw content recorded by default.
    expect(s.contentRecorded).toBe(false);
  });

  test("composes with a host-provided usage handler instead of clobbering it", async () => {
    const { ctx, evalbench, rows } = setup();
    let hostCalled = false;
    const agent: AgentLike = {
      options: {
        name: "demo",
        usageHandler: async () => {
          hostCalled = true;
        },
      },
    };
    withEvalbench(agent, { evalbench });

    await agent.options.usageHandler!(ctx, usageArgs);

    expect(hostCalled).toBe(true);
    expect(await rows()).toHaveLength(1);
  });

  test("records no content when recordContent is off (default)", async () => {
    const { ctx, evalbench, rows } = setup();
    const agent: AgentLike = { options: { name: "demo" } };
    withEvalbench(agent, { evalbench });

    await agent.options.rawRequestResponseHandler!(ctx, {
      request: { body: "the prompt" },
      response: { text: "the answer" },
    });
    await agent.options.usageHandler!(ctx, usageArgs);

    const s = (await rows())[0];
    expect(s.contentRecorded).toBe(false);
    expect(s.input).toBeUndefined();
    expect(s.output).toBeUndefined();
  });

  test("records raw content as span content when recordContent is on", async () => {
    const { ctx, evalbench, rows } = setup();
    const agent: AgentLike = { options: { name: "demo" } };
    withEvalbench(agent, { evalbench, recordContent: true });

    await agent.options.rawRequestResponseHandler!(ctx, {
      request: { body: "the prompt" },
      response: { text: "the answer" },
    });
    await agent.options.usageHandler!(ctx, usageArgs);

    const s = (await rows())[0];
    expect(s.contentRecorded).toBe(true);
    expect(s.input).toBe(JSON.stringify({ body: "the prompt" }));
    expect(s.output).toBe(JSON.stringify({ text: "the answer" }));
  });

  test("groups LLM calls of one operation into a single trace under a root", async () => {
    const { ctx, evalbench, rows } = setup();
    const agent: AgentLike = {
      options: { name: "demo" },
      // Simulate the agent firing the usage handler twice (two LLM steps)
      // during one top-level generateText call.
      generateText: async () => {
        await agent.options.usageHandler!(ctx, usageArgs);
        await agent.options.usageHandler!(ctx, usageArgs);
        return "result";
      },
    };
    withEvalbench(agent, { evalbench });

    const result = await agent.generateText!(ctx, {}, {});
    expect(result).toBe("result");

    const spans = await rows();
    // Two llm spans plus one root agent_step span.
    expect(spans).toHaveLength(3);
    const root = spans.find((s) => s.kind === "agent_step")!;
    const llm = spans.filter((s) => s.kind === "llm");
    expect(llm).toHaveLength(2);
    // All share one traceId; both llm spans link to the root.
    const traceIds = new Set(spans.map((s) => s.traceId));
    expect(traceIds.size).toBe(1);
    expect(root.parentSpanId).toBeUndefined();
    for (const s of llm) {
      expect(s.parentSpanId).toBe(root.spanId);
    }
    expect(root.status).toBe("success");
  });

  test("records an error root span when the operation throws", async () => {
    const { ctx, evalbench, rows } = setup();
    const agent: AgentLike = {
      options: { name: "demo" },
      generateText: async () => {
        throw new Error("boom");
      },
    };
    withEvalbench(agent, { evalbench });

    await expect(agent.generateText!(ctx, {}, {})).rejects.toThrow("boom");

    const spans = await rows();
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe("agent_step");
    expect(spans[0].status).toBe("error");
    expect(spans[0].errorType).toBe("Error");
  });
});
