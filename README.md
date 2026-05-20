# convex-evalbench

Reactive LLM eval, tracing, and regression layer as a
[Convex Component](https://www.convex.dev/components).

Capture spans from your agents, run datasets against them, score with
built-in scorers and LLM-as-judge, and watch results stream into a
reactive dashboard live, all inside your own Convex deployment.

> Status: early development. Phase 1 (tracing core plus the convex-agent
> adapter) is implemented. Datasets, the runner, and scorers come in later
> phases. See [HANDOVER.md](./HANDOVER.md) for the architecture, scope, and
> phase plan, and [docs/tracing.md](./docs/tracing.md) for the tracing
> reference.

## Tracing (Phase 1)

Record every LLM call as a span inside your own Convex deployment. Because
Convex is reactive, a trace renders as a live span tree that fills in while
it is in flight, no polling.

### Install and register

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import evalbench from "convex-evalbench/convex.config";

const app = defineApp();
app.use(evalbench);
export default app;
```

### Record spans (source-agnostic API)

Construct an `Evalbench` from the generated component handle and record
spans. Recording is best-effort: a failure is logged and swallowed, never
thrown back into your LLM call.

```ts
import { Evalbench } from "convex-evalbench";
import { components } from "./_generated/api.js";
import { action } from "./_generated/server.js";

const evalbench = new Evalbench(components.evalbench);

export const runStep = action({
  args: {},
  handler: async (ctx) => {
    const traceId = crypto.randomUUID();
    const rootSpanId = crypto.randomUUID();
    await evalbench.recordSpan(ctx, {
      traceId,
      spanId: rootSpanId,
      kind: "agent_step",
      operationName: "my operation",
      status: "success",
      startedAt: Date.now(),
    });
    await evalbench.recordSpan(ctx, {
      traceId,
      spanId: crypto.randomUUID(),
      parentSpanId: rootSpanId,
      kind: "llm",
      operationName: "llm call",
      model: "...",
      provider: "...",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      status: "success",
      startedAt: Date.now(),
      // input/output are recorded only when you pass them (opt-in).
      input: "the prompt",
      output: "the completion",
    });
  },
});
```

### Read it back (reactive)

Expose the queries from your host so a client can subscribe; the span tree
fills in live as spans are recorded.

```ts
import { query } from "./_generated/server.js";
import { v } from "convex/values";

export const listSpans = query({
  args: { traceId: v.string() },
  handler: (ctx, args) => evalbench.spansByTrace(ctx, args.traceId),
});

export const listRecentTraces = query({
  args: { limit: v.optional(v.number()) },
  handler: (ctx, args) => evalbench.recentTraces(ctx, args),
});

// Resolve a span's content on demand (inline strings plus signed URLs for
// content held in File Storage). `spanId` is the document id from listSpans.
export const getSpanContent = query({
  args: { spanId: v.string() },
  handler: (ctx, args) => evalbench.spanContent(ctx, args.spanId),
});
```

The tree and recent-traces queries return metadata only (no raw content),
so reactive updates stay small. Raw content is opt-in (you record it by
passing `input`/`output`); content at or below 4 KB is stored inline,
larger content is offloaded to Convex File Storage and resolved on demand.

### Wrap a @convex-dev/agent agent (optional)

The `withEvalbench` adapter is one optional ingestion source. It wraps a
[`@convex-dev/agent`](https://github.com/get-convex/agent) agent so each
LLM call is recorded as a span, composing with (not replacing) any handlers
you already set. `@convex-dev/agent` is an optional peer dependency; the
tracing core does not import it.

```ts
import { Agent } from "@convex-dev/agent";
import { Evalbench } from "convex-evalbench";
import { withEvalbench } from "convex-evalbench/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { components } from "./_generated/api.js";

const evalbench = new Evalbench(components.evalbench);

const agent = withEvalbench(
  new Agent(components.agent, {
    name: "my-agent",
    languageModel: anthropic("claude-haiku-4-5"),
  }),
  { evalbench, recordContent: true }, // recordContent defaults to false
);
```

LLM calls made inside one `generateText` / `generateObject` operation share
a `traceId` and link to a root `agent_step` span, so the operation renders
as one trace tree. See [docs/tracing.md](./docs/tracing.md) for details and
limitations.

## License

[Apache-2.0](./LICENSE)
