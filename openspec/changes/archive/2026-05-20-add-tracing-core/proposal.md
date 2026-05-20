## Why

When you build an app on an LLM or agent, output is non-deterministic and
there is no unit test for it. Step one to closing that gap is seeing what
the model actually did: the input, the output, the tokens, the cost, the
latency, and the call hierarchy. convex-evalbench starts here with a
tracing core that records every LLM call as a span inside the host's own
Convex deployment, so the trace view updates live over subscriptions
instead of polling. This is the foundation the dataset, runner, and scorer
phases build on, and it is useful on its own as observability for AI calls.

## What Changes

- Add an `eval_traces` table: one row per span, with hierarchy
  (`traceId`, `spanId`, `parentSpanId`), kind, model, token counts, cost,
  latency, status, and timing.
- Add a best-effort span ingestion API behind a single internal write
  seam, so a self-managed batching or rate-bounding layer can be added
  later without changing callers. No external Workpool dependency; bounded
  rate batching is deferred.
- Store raw span content (input/output) in Convex File Storage above a
  configurable size threshold, inline below it. Recording raw content is
  opt-in via a content-recording flag; metadata is always recorded.
- Add reactive queries: a span tree by `traceId` (fills in live while a
  trace is in flight) and a recent-traces list.
- Add a `withEvalbench(agent)` adapter as one optional ingestion source
  that wraps a `@convex-dev/agent` agent and forwards its `usageHandler`
  and `rawRequestResponseHandler` into the tracing ingestion, composing
  with any host-provided handlers rather than replacing them. The core does
  not require it.
- Add the matching `Evalbench` client methods (span recording helpers,
  `spansByTraceId`, `recentTraces`) and the `withEvalbench` export with its
  entry in the exports map.
- Wrap a demo agent in `example/convex` and prove spans land and render as
  a live tree.

## Capabilities

### New Capabilities
- `tracing`: the source-agnostic span model. Best-effort span recording API
  behind a single write seam, File Storage content handling with opt-in
  recording, and the reactive span-tree and recent-traces queries. Usable
  on its own, without any agent.
- `convex-agent-adapter`: `withEvalbench(agent)`, one optional ingestion
  source. Maps `@convex-dev/agent` usage and raw request/response hooks
  onto the tracing ingestion API, composing with existing host handlers.

### Modified Capabilities
None. This is the first capability set; the component schema is empty today.

## Impact

- Dependencies: no new required dependency. `@convex-dev/agent` is an
  optional peer dependency, used only by the adapter export; the tracing
  core does not import it. Bounded write rate, if needed later, is
  implemented in-component rather than via an external Workpool dependency.
- Component: `src/component/schema.ts` (new `eval_traces` table and
  indexes), `src/component/convex.config.ts` (use the Workpool component),
  new component function files for ingestion mutations, content storage,
  and queries.
- Client: `src/client/index.ts` gains tracing methods on `Evalbench`; a new
  adapter module exports `withEvalbench`, added to the `exports` map in
  `package.json`.
- Example: `example/convex` gains a demo agent wrapped with the adapter,
  its own schema, and a minimal live span-tree readout for verification.
- Config: a content-recording flag and content-size threshold, surfaced
  through the component or adapter configuration.

## Non-goals (deferred to later phases)

- Datasets, dataset items, the eval runner, and scorers (Phase 2 and 3).
- Judges (`llmAsJudge`, multi-judge consensus) and `defineScorer` (Phase 3).
- Other ingestion sources: OTLP HTTP receiver, Vercel AI SDK middleware
  (Phase 2 product).
- A full dashboard. Phase 1 ships only a minimal span-tree readout in the
  example for verification; the richer UI is Phase 4 or a companion repo.
- Bounded-rate ingestion batching / a self-managed work queue. The single
  write seam is in place so this can be added later; Phase 1 writes are
  direct and best-effort.
- Retention and pruning of old spans, cross-deployment runs, and
  multi-tenancy or dataset ownership (later phases).
