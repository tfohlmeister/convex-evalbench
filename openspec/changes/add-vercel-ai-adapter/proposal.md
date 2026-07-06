## Why

The tracing core is source-agnostic, but today only one ingestion
adapter ships: `withEvalbench` for `@convex-dev/agent`. A large share of
Convex LLM code calls the Vercel AI SDK (`ai`) directly, through
`generateText` / `streamText` / `generateObject`, without the agent
component. Those calls record nothing. The AI SDK already exposes the
right seam for this, `wrapLanguageModel` middleware, so an adapter can
record a span per model call with no changes to the caller's code and no
LLM SDK leaking into the tracing core.

## What Changes

- Add a **Vercel AI SDK middleware adapter** exported at
  `convex-evalbench/ai`. It builds a `LanguageModelV2Middleware` that a
  host wraps around any AI SDK model:

  ```ts
  const model = wrapLanguageModel({
    model: anthropic("claude-haiku-4-5"),
    middleware: evalbenchMiddleware({ evalbench, ctx }),
  });
  ```

  Each `generateText` / `streamText` / `generateObject` call through the
  wrapped model records one `llm` span via the tracing ingestion API,
  mapping model, provider, token usage, measured latency, and status
  onto the span.
- Unlike the agent adapter (which reads a post-response `usageHandler`
  and cannot time the call), the middleware **wraps** the call, so
  `latencyMs` is measured from real call start to end.
- Content recording is **opt-in** (`recordContent`, default off),
  delegating inline-versus-File-Storage handling to the ingestion API,
  consistent with the agent adapter.
- The middleware accepts optional `traceId` / `runId` / `parentSpanId`
  so eval-run targets can stamp their spans for correlation, and so a
  caller with an existing trace can thread it in.
- `ai` becomes an **optional peer dependency** (it is a devDependency
  today); the tracing core neither imports it nor depends on it, and the
  adapter describes the AI SDK types structurally so the package builds
  and tests without `ai` installed (mirrors the agent adapter).

## Capabilities

### New Capabilities
- `vercel-ai-adapter`: an optional ingestion source that wraps a Vercel
  AI SDK model as `LanguageModelV2Middleware`, records a span per model
  call through the tracing ingestion API (with measured latency), maps
  AI SDK usage onto span fields, records content only when opted in,
  supports caller-supplied trace/run correlation, and never breaks the
  wrapped call.

### Modified Capabilities
<!-- None. The adapter consumes the existing tracing ingestion API
     (recordSpan) unchanged; it changes no tracing requirement. -->

## Impact

- Client: new `src/client/ai.ts`; new `./ai` entry in the exports map
  (types + default), mirroring `./agent`.
- Dependencies: `ai` moves from devDependencies to `peerDependencies`
  with `peerDependenciesMeta.ai.optional = true`; it stays installed for
  the dev loop and tests.
- Docs: an "Ingestion sources" subsection in `docs/tracing.md` for the
  AI SDK adapter; an example in `example/convex`; the README roadmap
  note moves from "Next" to shipped.
- No component or schema changes; spans record through the existing
  ingestion seam.

## Non-goals (deferred)

- The OTLP HTTP receiver (a separate change, `add-otlp-receiver`).
- A synthetic root `agent_step` span per operation: the middleware sits
  below `generateText`, so multi-step calls record sibling `llm` spans
  under a shared `traceId` (a caller who wants a root records it or
  passes `parentSpanId`).
- Cost computation (`costUsd`) from usage; left unset unless the caller
  supplies it later.
- Automatic trace grouping across independent operations that share one
  middleware instance; per-operation instances (the natural per-`ctx`
  construction) keep traces separate.
