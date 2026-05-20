## 1. Schema and shared types

- [x] 1.1 Add the `eval_traces` table to `src/component/schema.ts` with the
  fields from design D2 (identity/hierarchy, classification, metrics,
  status/timing, content, metadata) and the four indexes (`by_trace`,
  `by_parent_started`, `by_run`, `by_thread`).
- [x] 1.2 Add isomorphic span types and the span validator to
  `src/shared.ts` (the `kind` and `status` unions, the span input shape),
  reused by component functions and the client.
- [x] 1.3 Run codegen (`pnpm run build:codegen`) so `_generated` reflects
  the new table; confirm `pnpm check` is green.

## 2. Ingestion core (the single write seam)

- [x] 2.1 Implement `ingestion.writeSpanRow` as a component internal
  mutation: the single seam that inserts an `eval_traces` row from a
  validated span record.
- [x] 2.2 Implement the content path: a component action that, when content
  recording is on and content exceeds the threshold, stores `input`/
  `output` blobs via `ctx.storage.store` and passes the resulting storage
  ids to the write seam; small content stays inline. Add the configurable
  threshold constant (default 4 KB).
- [x] 2.3 Wire a metadata-only fast path (no content) straight to the write
  seam, skipping the action hop.
- [x] 2.4 Add convex-test unit tests for ingestion: metadata-only span,
  inline small content, large content offloaded to File Storage, and
  content-disabled (no content persisted). Keep `pnpm check` green.

## 3. Reactive queries

- [x] 3.1 Implement `spansByTrace(traceId)` (component query): all spans of
  a trace ordered by `startedAt`, metadata only, no content.
- [x] 3.2 Implement `recentTraces({ limit })` (component query): root spans
  (`parentSpanId == undefined`) newest first via `by_parent_started`.
- [x] 3.3 Implement `spanContent({ spanId })` (component query): inline
  content plus `ctx.storage.getUrl` signed URLs for stored blobs.
- [x] 3.4 Add convex-test tests for the three queries, including a test
  that recording another span changes the `spansByTrace` result (the live
  fill-in behavior).

## 4. Client API surface

- [x] 4.1 Add `Evalbench` methods in `src/client/index.ts`: best-effort
  `recordSpan(ctx, span)` (swallows its own errors, never throws back),
  `spansByTrace`, `recentTraces`, `spanContent`, mirroring the
  `convex-mcp-gateway` client method pattern.
- [x] 4.2 Confirm the existing exports map already surfaces these (no new
  entry needed for the core); `pnpm check` green.

## 5. Core verification in the example (no agent)

- [x] 5.1 In `example/convex`, add a demo action that records a small trace
  of spans (a root plus a couple of children) through `recordSpan`, using
  the generic API only.
- [x] 5.2 Add a minimal live span-tree readout (a query subscription
  rendering the tree from `spansByTrace`) and verify with the
  `playwright-cli` skill that spans appear and the tree fills in live as
  the demo action records them.

## 6. Agent adapter (one optional source)

- [x] 6.1 Spike (R2): determine whether `withEvalbench(agent)` can inject
  `usageHandler` and `rawRequestResponseHandler` into an already
  constructed agent (merge into `agent.options`). If not, pivot the adapter
  to a construction-time wrapper. Record the outcome in design.md.
- [x] 6.2 Spike (R3): determine how to correlate the per-call handler
  invocations into one trace (wrap the top-level generate/stream call to
  open a root span and share a `traceId`; merge usage and raw content by
  nearest-in-time). If too fragile, fall back to one span per LLM call
  under a wrapper-created root. Record the outcome.
- [x] 6.3 Implement `withEvalbench(agent, { evalbench, recordContent? })`
  in a new adapter module: forward `usageHandler`/`rawRequestResponseHandler`
  into `evalbench.recordSpan`, composing with (not clobbering) any host
  handlers, with `recordContent` default false.
- [x] 6.4 Add `@convex-dev/agent` as an optional peer dependency and add the
  adapter export to the `package.json` exports map; the core must still
  build and test without the agent installed.
- [x] 6.5 Add convex-test tests for the adapter: usage maps to span fields,
  host handler still runs (composition), content opt-in on/off.

## 7. Adapter verification and docs

- [x] 7.1 In `example/convex`, wrap a demo agent with `withEvalbench` and
  verify with `playwright-cli` that a real agent operation renders as a
  live trace tree.
- [x] 7.2 Update README / add `docs/` notes for the tracing capability and
  the adapter (setup, the content-recording opt-in, the queries).
- [x] 7.3 Final gate: `pnpm check` green, both example verifications pass.
