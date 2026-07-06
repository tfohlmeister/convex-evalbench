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

> Status: tracing (with the `@convex-dev/agent` adapter), versioned
> datasets, the eval runner, deterministic scorers, LLM-as-judge with
> multi-judge consensus, `embeddingSimilarity`, custom scorers, and
> run comparison with a CI regression gate are shipped. See the
> [roadmap](#roadmap). References: [docs/tracing.md](./docs/tracing.md),
> [docs/evals.md](./docs/evals.md).

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

## Evals: datasets, runs, scorers

Keep a versioned dataset of inputs with expected outputs, run your
system under test against every item with bounded parallelism, and
watch the pass rate fill in live.

```ts
// Seed a dataset.
const datasetId = await evalbench.createDataset(ctx, {
  name: "greetings",
  items: [
    { input: "hello", expectedOutput: "HELLO" },
    { input: "world", expectedOutput: "WORLD" },
  ],
});

// The system under test: an action taking { input, runId, itemId } and
// returning { output, traceId? }. Stamp your spans with runId so the
// run's traces correlate.
export const myTarget = action({
  args: { input: v.any(), runId: v.string(), itemId: v.string() },
  handler: async (ctx, args) => {
    const output = await runMyAgent(args.input);
    return { output };
  },
});

// Run it: one idempotent, scored result per item.
const runId = await evalbench.startRun(ctx, {
  datasetId,
  target: api.evals.myTarget,
  config: { scorers: [{ type: "exactMatch" }], concurrency: 4 },
});
```

Subscribe to `evalbench.runSummary(ctx, runId)` for the live counters
(completed / passed / aggregate score, maintained in the same mutation
that writes each result) and `evalbench.listResults(ctx, runId)` for
the per-item rows with scores and trace links.

Scorers: deterministic built-ins `exactMatch` and `jsonSchema`
(eval-free JSON Schema validation that runs in Convex's V8 runtime),
plus host-extensible scoring with no provider SDK in the component:
`defineScorer` for custom scorer actions, `llmAsJudge` for
rubric-based judging with your own LLM call (each verdict traced as a
`judge` span), multi-judge `consensus` with a quorum, and
`embeddingSimilarity` against a host embedder action. A wedged run is
recovered with `evalbench.redriveRun(ctx, runId)` (attempts-capped).
See [docs/evals.md](./docs/evals.md) for the target and scorer
contracts, versioning, and the runner's execution model.

<!-- END: Include on https://convex.dev/components -->

## Local development

The repo bundles a pinned `convex-local-backend`, so the example app and
tests run without a cloud Convex project. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the dev loop and release flow.

## Roadmap

Tracing, datasets, the runner, judges (LLM-as-judge with consensus),
`embeddingSimilarity`, custom scorers, regression / A-B (run comparison
with a CI gate), and trace retention (host-invoked `pruneTraces`) are
shipped. Next:

- **More ingestion sources**: OTLP HTTP receiver, Vercel AI SDK
  middleware.
- **Live dashboard**: a companion app on top of the reactive queries;
  managed retries for the runner.

## Security

Raw prompt/completion content is only stored when you opt in; span
metadata is always recorded. See [SECURITY.md](./SECURITY.md) for the
threat model and how to report vulnerabilities.

## License

[Apache-2.0](./LICENSE)
