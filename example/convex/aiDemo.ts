import { anthropic } from "@ai-sdk/anthropic";
import { generateText, wrapLanguageModel } from "ai";
import { Evalbench } from "convex-evalbench";
import { evalbenchMiddleware } from "convex-evalbench/ai";
import { v } from "convex/values";

import { components } from "./_generated/api.js";
import { action } from "./_generated/server.js";

const evalbench = new Evalbench(components.evalbench);

/**
 * Record a direct Vercel AI SDK call as a span. The middleware is built
 * inside the handler, where the Convex `ctx` and the model live, and
 * wrapped around the model with `wrapLanguageModel`; each call through the
 * wrapped model records one `llm` span with measured latency. `recordContent`
 * captures the prompt and completion. This is the optional AI SDK ingestion
 * source; the tracing core does not require it.
 */
export const runAiSdkDemo = action({
  args: { prompt: v.string() },
  returns: v.object({ text: v.string() }),
  handler: async (ctx, args) => {
    const model = wrapLanguageModel({
      model: anthropic("claude-haiku-4-5"),
      middleware: evalbenchMiddleware({ evalbench, ctx, recordContent: true }),
    });
    const result = await generateText({ model, prompt: args.prompt });
    return { text: result.text };
  },
});
