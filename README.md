# convex-evalbench

Reactive LLM eval, tracing, and regression layer as a
[Convex Component](https://www.convex.dev/components).

Capture spans from your agents, run datasets against them, score with
built-in scorers and LLM-as-judge, and watch results stream into a
reactive dashboard live, all inside your own Convex deployment. No
extra infrastructure, no polling: Convex subscriptions push every new
span to your UI as it lands.

[![Convex Component](https://www.convex.dev/components/badge/convex-evalbench)](https://www.convex.dev/components/convex-evalbench)
[![tests](https://img.shields.io/github/actions/workflow/status/tfohlmeister/convex-evalbench/test.yml?branch=main&label=tests)](https://github.com/tfohlmeister/convex-evalbench/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/convex-evalbench.svg)](https://www.npmjs.com/package/convex-evalbench)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

<!-- START: Include on https://convex.dev/components -->

> Status: v0.1.0 ships the tracing core and the `@convex-dev/agent`
> adapter. Datasets, the eval runner, and scorers are next; see the
> [roadmap](#roadmap). [docs/tracing.md](./docs/tracing.md) is the
> tracing reference.

## Tracing

Record every LLM call as a span inside your own Convex deployment. Because
Convex is reactive, a trace renders as a live span tree that fills in while
it is in flight, no polling.

### Install and register

```sh
npm install convex-evalbench
```

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

<!-- END: Include on https://convex.dev/components -->

## Local development

The repo bundles a pinned `convex-local-backend`, so the example app and
tests run without a cloud Convex project. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the dev loop and release flow.

## Roadmap

Tracing is the foundation; the eval layer is built on top of it:

- **Datasets and eval runner**: versioned datasets of example inputs
  with expected outputs, a `startRun` action that executes a target
  against every item with bounded parallelism, idempotent per-item
  results linked to their traces, and a reactive run summary.
- **Scorers and judges**: `exactMatch` and `jsonSchema` first, then
  `embeddingSimilarity`, `llmAsJudge` (traced as a `judge` span),
  multi-judge consensus, and host-defined custom scorers.
- **Regression / A-B**: compare prompt or model version A against B on
  the same dataset; CI gate.
- **More ingestion sources**: OTLP HTTP receiver, Vercel AI SDK
  middleware.
- **Live dashboard**: a companion app on top of the reactive queries;
  retention/prune helpers.

## Security

Raw prompt/completion content is only stored when you opt in; span
metadata is always recorded. See [SECURITY.md](./SECURITY.md) for the
threat model and how to report vulnerabilities.

## License

[Apache-2.0](./LICENSE)
