## Context

The component schema is empty today (foundation cut). This change adds the
first real capability set: a tracing core (`tracing`) and the first
ingestion source on top of it (`convex-agent-adapter`). See `proposal.md`
for motivation.

Verified facts that shape this design (researched 2026-05-20):

- `convex-mcp-gateway` (the reference component) splits component functions
  across domain files, exposes a host handle class constructed from
  `components.<name>` whose methods call
  `ctx.run{Query,Mutation,Action}(this.component.<file>.<fn>, args)`, keeps
  isomorphic helpers in `src/shared.ts`, and ships a `register()` test
  helper in `src/test.ts`. It does NOT nest another Convex component, so the
  Workpool-inside-a-component pattern has no in-repo precedent.
- `@convex-dev/agent` (0.6.1) exposes two ingestion hooks:
  - `usageHandler(ctx, { userId, threadId, agentName, usage, providerMetadata, model, provider })`,
    fires after a generation. Settable on the constructor AND per-call
    (per-call overrides, it does not chain).
  - `rawRequestResponseHandler(ctx, { userId, threadId, agentName, request, response })`,
    fires per request/response. Settable on the constructor ONLY.
  - Both receive an `ActionCtx` with `runQuery/runMutation/runAction/storage/auth`,
    so a handler can write into our component via `ctx.runMutation`.
  - There is no built-in "wrap an agent" helper, and neither handler
    exposes an explicit per-run or per-call id for grouping.
- `@convex-dev/workpool` (0.4.6) exists for bounded-rate enqueueing, but
  nesting it inside a custom component is not officially documented. Since
  bounded write rate is not a hard Phase 1 constraint, this change does NOT
  take that dependency (see D7).

## Goals / Non-Goals

**Goals:**
- A source-agnostic span data model and best-effort ingestion API behind a
  single internal write seam, storing large content in File Storage with
  content recording opt-in.
- Reactive queries that render a trace as a live span tree and list recent
  traces.
- One optional ingestion source, `withEvalbench`, mapping convex-agent
  hooks onto the ingestion API and composing with host handlers. The core
  must be usable and verifiable without it.
- Prove the core end to end in `example/convex` via the generic API, and
  demonstrate the agent adapter as one source.

**Non-Goals:**
- Datasets, runner, scorers, judges (later phases).
- Other ingestion sources (OTLP, AI SDK middleware).
- Generic open/close span instrumentation API for arbitrary host code
  (only what the adapter needs lands now).
- A full dashboard; only a minimal span-tree readout for verification.

## Decisions

### D1. Two capabilities, source-agnostic core

`tracing` owns the schema, ingestion API, content storage, and queries and
imports nothing from `@convex-dev/agent`. `convex-agent-adapter` is a thin
client-side wrapper that calls the tracing ingestion API. This keeps the
obsolescence and hook-breakage risk of the agent dependency at the edge,
and lets Phase 2 sources (OTLP, AI SDK) be added as sibling adapters
without touching the core. Alternative considered: fold the adapter into
the core. Rejected, it couples the engine to one SDK.

### D2. Data model: one `eval_traces` row per span

Fields (all in `src/component/schema.ts`):

- Identity / hierarchy: `traceId` (string), `spanId` (string),
  `parentSpanId?` (string), `runId?` (string, null for production spans;
  the Phase 2 runner populates it; kept now to avoid a later migration).
- Classification: `kind` (`"llm" | "tool" | "agent_step" | "workflow_step" | "judge"`),
  `operationName` (string), `agentName?`, `threadId?`, `userId?`,
  `model?`, `provider?`.
- Metrics: `inputTokens?`, `outputTokens?`, `totalTokens?`, `latencyMs?`,
  `costUsd?`.
- Status / timing: `status` (`"running" | "success" | "error"`),
  `errorType?`, `startedAt` (number), `endedAt?` (number).
- Content: `input?` / `output?` (inline strings, only when small and
  recorded), `inputStorageId?` / `outputStorageId?` (`v.id("_storage")`,
  for large recorded content), `contentRecorded?` (boolean).
- `metadata?` (`v.any()`) for provider extras (e.g. cache token details).

Indexes:
- `by_trace` on `["traceId", "startedAt"]`: the span-tree query.
- `by_parent_started` on `["parentSpanId", "startedAt"]`: recent traces are
  root spans, queried with `q.eq("parentSpanId", undefined)`; also serves
  children-by-parent lookups.
- `by_run` on `["runId", "startedAt"]`: Phase 2 run spans.
- `by_thread` on `["threadId", "startedAt"]`: per-thread view.

Rationale: a flat span table with a `parentSpanId` lets the client
assemble the tree, matches how every tracing system models spans, and
keeps writes as independent inserts (no parent-document contention).

### D3. Span content in File Storage, recording opt-in (the locked choice)

Metadata is always recorded. Raw `input`/`output` are recorded only when
the source enables it (default off). When recording:
- content at or below a configurable threshold (default 4 KB) is stored
  inline in `input`/`output`;
- larger content is written to the component's File Storage and the row
  holds `inputStorageId` / `outputStorageId`.

The span-tree and recent-traces queries return metadata only (no content,
no blob fetch) so the tree renders fast and cheaply. A separate
`spanContent` query resolves content on demand: inline strings directly,
plus `ctx.storage.getUrl(storageId)` signed URLs for stored blobs that the
client fetches lazily when a span is expanded.

Rationale: spans can be 4 to 32 KB; returning content in the live tree
query would multiply subscription bandwidth on every reactive update.
File Storage from day one keeps large blobs out of the document and out of
the hot query path. Alternative considered: inline-only with deferred File
Storage. Rejected by the project decision to be production-shaped now;
inline-only would force a migration once content sizes grow.

### D4. Ingestion flow: action to write seam

Because the component owns its File Storage and `ctx.storage.store` is an
action capability, the ingestion entry point is a component action when
content recording is on; metadata-only recording can go straight to a
mutation.

1. Source handler (runs in the host/agent ActionCtx) calls the Evalbench
   client method `recordSpan(ctx, span)`, which runs component ingestion.
2. When content recording is on and content exceeds the threshold, a
   component action stores the blobs (`await ctx.storage.store(...)`) to get
   storage ids, then calls the write seam; otherwise the content path is
   skipped.
3. `ingestion.writeSpanRow` (component internal mutation) is the single
   write seam: it inserts the `eval_traces` row. All ingestion, from any
   source, funnels through this one mutation.

Ingestion is best-effort: `recordSpan` swallows its own errors and never
throws back into the host's LLM call (mirrors `convex-mcp-gateway`'s
`safeRecordAudit`). Losing a span is the accepted failure mode.

### D7. No external Workpool dependency; one write seam

Phase 1 writes spans directly through the single `writeSpanRow` seam rather
than enqueueing through `@convex-dev/workpool`. Bounded write rate is not a
hard Phase 1 constraint, span inserts are independent (so OCC contention is
minimal), and nesting Workpool inside a custom component is undocumented
(former R1). Funnelling every source through one internal mutation keeps
the option open to add self-managed batching or rate limiting there later
(a queue table drained on a schedule, or batched inserts) without changing
any caller or the public API. Alternatives considered: take the Workpool
component (rejected, undocumented nesting plus a dependency for a
non-constraint); build the self-managed queue now (rejected as premature,
no Phase 1 load justifies it).

### D5. Adapter shape and handler composition

`withEvalbench(agent, { evalbench, recordContent? })` (standalone export,
new entry in the `package.json` exports map) returns a wrapped agent whose
`usageHandler` and `rawRequestResponseHandler` forward into
`evalbench.recordSpan`. It composes: if the host already set a handler, the
wrapper calls the original (awaited) and then records, so host handlers are
never clobbered. `recordContent` (default false) drives D3 opt-in for this
source; the host can wire it from its own env.

`usageHandler` carries tokens, model, provider; `rawRequestResponseHandler`
carries the raw request/response used as span content. One LLM call thus
surfaces through two handlers, which must be correlated into one span (see
R3). `recordSpan` itself is the source-agnostic seam, so manual host
instrumentation and future adapters reuse it.

### D6. Reactive query shapes

- `spansByTrace(traceId) -> Span[]` (metadata only), ordered by `startedAt`;
  the client builds the tree from `parentSpanId`. Reactive: as each LLM or
  tool call in a run records a span, the subscription pushes it and the
  tree fills in live.
- `recentTraces({ limit }) -> RootSpanSummary[]`: root spans
  (`parentSpanId == undefined`) newest first.
- `spanContent({ spanId }) -> { input?, output?, inputUrl?, outputUrl? }`:
  on-demand content resolution (inline plus signed URLs).

## Risks / Trade-offs

- **R1 (resolved). Workpool nesting.** Dropped: D7 removes the Workpool
  dependency, so the undocumented nested-component path is no longer on the
  table.
- **R2. `rawRequestResponseHandler` is constructor-only.** It cannot be
  injected per-call into an already-constructed agent. If reading
  `agent.options` and merging post-construction does not take effect,
  `withEvalbench(agent)` cannot capture raw content. This affects only the
  optional adapter, not the core. Mitigation: spike post-construction
  injection; if it fails, the adapter becomes a construction-time wrapper
  (e.g. `withEvalbench(config)` merged into the agent's config before
  `new Agent(...)`). `usageHandler` works either way since it is also
  per-call.
- **R3. No explicit run/call id from the agent for span correlation.** The
  two handlers fire separately per LLM call and neither exposes a stable
  per-call or per-run id, so grouping calls into one trace and merging the
  usage span with its raw-content span is not obviously solved. This is an
  adapter concern; the core's generic API takes explicit ids from the
  caller, so it is unaffected. Mitigation: spike correlation. Likely
  approach: the adapter wraps the top-level generate/stream call to open a
  root span and establish a per-call trace id that child handler
  invocations share; merge usage and raw-content by nearest-in-time within
  that call. The schema already carries `traceId`/`spanId`/`parentSpanId`
  regardless of the mechanism. If correlation proves too fragile, the
  adapter can ship recording one span per LLM call (flat under a
  wrapper-created root) and the agent adapter can even be deferred to a
  follow-up change without blocking the core.
- **R4. Root-span liveness needs two writes.** A root span written
  `running` at call start and patched to `success`/`error` at end is the
  one place a span row is updated (potential OCC). Acceptable at one update
  per agent call; if it bites, drop the live-root and record the root only
  at completion (children still stream in live).
- **R5. `@convex-dev/agent` as a dependency.** Kept optional/peer and
  isolated to the adapter export so the core never imports it; hook drift
  only affects `convex-agent-adapter`.

## Spike outcomes (2026-05-20, implementation)

- **R2 resolved: post-construction injection works.** `Agent` stores
  `this.options = options` as a mutable instance field and reads handlers
  from the per-call config derived by spreading `...this.options` at each
  generation. `start.js` invokes `opts.rawRequestResponseHandler` then
  `opts.usageHandler` (in that order) per LLM step, where `opts` is the
  per-call merge of `this.options`. So `withEvalbench` injects both
  handlers by assigning to `agent.options.usageHandler` /
  `agent.options.rawRequestResponseHandler` after construction; no
  construction-time pivot is needed. The adapter composes by capturing the
  pre-existing handlers and calling them before recording.
- **R3 resolved: wrap the top-level call, correlate within a step.** The
  two handlers fire sequentially for the same step and neither carries a
  per-call id. The adapter (a) wraps the awaitable top-level operations
  (`generateText`, `generateObject`) to open a per-operation trace context
  (a fresh `traceId` plus a root `agent_step` span) shared by the LLM spans
  recorded during the call, which realizes the "one trace" grouping; and
  (b) correlates usage with raw content within a step via a single
  pending-content slot that `rawRequestResponseHandler` fills and the
  immediately-following `usageHandler` drains into one span. This is
  reliable for sequentially awaited generations; concurrent generations on
  the *same* wrapped agent instance may mis-pair content or mis-group
  spans (documented; use separate agent instances for concurrency).
- **R4 resolved by recording the root at completion.** The root
  `agent_step` span is recorded once when the wrapped call resolves (with
  final status and latency), so no span-update seam or `by_span` index is
  needed. LLM child spans still stream in live during the call; the root
  caps the tree at the end. Streaming operations (`streamText`,
  `streamObject`) are left unwrapped in Phase 1: their spans are recorded
  flat (each LLM call its own single-span trace), since the stream
  lifecycle does not fit the open/close-at-resolve root cleanly.

## Migration Plan

Greenfield: the component schema is empty, so adding `eval_traces` needs no
data migration. `runId` is included now to avoid a Phase 2 schema change.
Rollback is removing the change; nothing depends on it yet. Each task is
ordered so `pnpm check` stays green at every committable step: the core
(schema, ingestion seam, File Storage, queries) lands and is verified
first, then the optional agent adapter, whose spikes (R2, R3) do not block
the core.

## Open Questions

- If bounded ingestion rate becomes necessary later, do we add self-managed
  batching at the `writeSpanRow` seam, and does the Phase 2 runner reuse it?
  (Defer; does not block Phase 1.)
- Final default for the inline/File-Storage threshold (4 KB is a starting
  point, to confirm against real agent payloads during the spike).
- Whether `recentTraces` should return a precomputed per-trace summary
  (span count, totals) or compute it client-side from `spansByTrace`.
  Leaning client-side for MVP to avoid an aggregate write path.
