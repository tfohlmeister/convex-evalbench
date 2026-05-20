import { anthropic } from "@ai-sdk/anthropic";
import { Agent } from "@convex-dev/agent";
import { Evalbench } from "convex-evalbench";
import { withEvalbench } from "convex-evalbench/agent";
import { v } from "convex/values";

import { components } from "./_generated/api.js";
import { action } from "./_generated/server.js";

const evalbench = new Evalbench(components.evalbench);

/**
 * A real `@convex-dev/agent` agent, wrapped with `withEvalbench` so every
 * LLM call it makes is recorded as a span. `recordContent` is on so the
 * raw request/response is captured as span content (exercising the
 * File-Storage-backed content path). This is the optional ingestion
 * source; the tracing core does not require it.
 */
const agent = withEvalbench(
  new Agent(components.agent, {
    name: "demo-agent",
    languageModel: anthropic("claude-haiku-4-5"),
    instructions: "You are a terse assistant. Answer in one short sentence.",
  }),
  { evalbench, recordContent: true },
);

/**
 * Run the wrapped agent against a prompt. The wrapped `generateText` opens
 * a trace, records the LLM call(s) as spans, and caps the tree with a root
 * `agent_step` span. Subscribe to `demo.listRecentTraces` / `demo.listSpans`
 * to watch the trace appear and fill in live.
 */
export const runAgentDemo = action({
  args: { prompt: v.string() },
  returns: v.object({ text: v.string() }),
  handler: async (ctx, args) => {
    const { threadId } = await agent.createThread(ctx, {});
    const result = await agent.generateText(
      ctx,
      { threadId },
      { prompt: args.prompt },
    );
    return { text: result.text };
  },
});
