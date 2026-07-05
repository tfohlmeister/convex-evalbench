# Tracing reference

The tracing core records every LLM (or tool, agent-step, workflow-step,
judge) call as a span inside your own Convex deployment. It is
source-agnostic: the generic `recordSpan` API takes explicit ids and does
not import any LLM SDK. The convex-agent adapter (`withEvalbench`) is one
optional source built on top of it.

## Data model

One `eval_traces` row per span. Spans are flat and linked by
`parentSpanId`; the client assembles the tree. This keeps writes as
independent inserts with no parent-document contention.

Fields (see `src/shared.ts`):

- Identity / hierarchy: `traceId`, `spanId`, `parentSpanId?`, `runId?`
  (null in production; the future runner populates it).
- Classification: `kind` (`llm | tool | agent_step | workflow_step |
  judge`), `operationName`, `agentName?`, `threadId?`, `userId?`, `model?`,
  `provider?`.
- Metrics: `inputTokens?`, `outputTokens?`, `totalTokens?`, `latencyMs?`,
  `costUsd?`.
- Status / timing: `status` (`running | success | error`), `errorType?`,
  `startedAt`, `endedAt?`.
- Content: `input?` / `output?` (inline), `inputStorageId?` /
  `outputStorageId?` (File Storage), `contentRecorded?`.
- `metadata?` for provider extras.

Indexes: `by_trace` (`traceId, startedAt`) for the span tree;
`by_parent_started` (`parentSpanId, startedAt`) for recent traces (root
spans, `parentSpanId == undefined`) and children-by-parent;
`by_run` and `by_thread` for the upcoming eval runner and per-thread
views.

## Ingestion

All span writes funnel through one internal write seam
(`ingestion.writeSpanRow`), so batching or rate limiting can be added later
without changing callers. The current version writes directly; there is
no external Workpool dependency.

The client's `recordSpan(ctx, span)` routes by content:

- No `input`/`output`: a metadata-only fast path (`ingestion.recordSpan`,
  a mutation) straight to the write seam.
- With `input`/`output`: the content path (`ingestion.recordSpanWithContent`,
  an action, because File Storage needs an action). Per field, content at
  or below the threshold is stored inline; larger content is written to
  File Storage and the row holds the storage id.

Recording is best-effort: `recordSpan` swallows its own errors and never
throws back into the caller. If content is present but `ctx` cannot run
actions (a query/mutation context), the span is still recorded with content
dropped.

### Content recording opt-in and the inline threshold

Metadata is always recorded; raw `input`/`output` only when the source
passes them. The inline-versus-File-Storage threshold is
`INLINE_CONTENT_THRESHOLD_BYTES` (4 KB, UTF-8) in `src/shared.ts`. The tree
and recent-traces queries never return raw content, so reactive updates
stay small; content is resolved on demand via `spanContent`, which returns
inline strings directly and `ctx.storage.getUrl` signed URLs for stored
blobs.

## Queries

- `spansByTrace(traceId) -> Span[]`: all spans of a trace, oldest first,
  metadata only. Reactive: new spans are pushed as they are recorded, so a
  trace renders as a live filling-in tree. Build the tree from
  `parentSpanId`.
- `recentTraces({ limit }) -> Span[]`: root spans newest first (default 50,
  capped at 200).
- `spanContent({ spanId }) -> { input?, output?, inputUrl?, outputUrl? }`:
  on-demand content. `spanId` is the `eval_traces` document id from
  `spansByTrace`.

These are component queries; expose them from your host (wrap each in a
host `query`) so clients can subscribe.

## The convex-agent adapter

`withEvalbench(agent, { evalbench, recordContent? })` wraps a
`@convex-dev/agent` agent and returns it (mutated in place). It is the only
part that knows about the agent SDK, and even so it describes the agent
structurally rather than importing it, so the core builds and tests without
`@convex-dev/agent` installed.

Mechanism (verified against `@convex-dev/agent` 0.6.1):

- Handlers are injected by assigning to `agent.options.usageHandler` and
  `agent.options.rawRequestResponseHandler` after construction. The agent
  reads these per call (it spreads `this.options` into each generation), so
  post-construction injection takes effect. Existing host handlers are
  composed with, not clobbered: the original runs, then the span is
  recorded.
- `usageHandler` maps model, provider, token usage, and
  agent/thread/user identifiers onto the span.
- The awaitable top-level operations (`generateText`, `generateObject`) are
  wrapped to open a per-operation `traceId` and a root `agent_step` span
  (recorded at completion with final status and latency), so the LLM calls
  within one operation share a trace and link to that root.
- When `recordContent` is on, `rawRequestResponseHandler` buffers the raw
  request/response and the immediately-following `usageHandler` drains it
  onto the same span as content.

### Limitations

- Correlation of usage with raw content, and grouping into one trace, is
  reliable for sequentially awaited generations. Concurrent generations on
  the *same* wrapped agent instance share the per-operation state and may
  mis-group or mis-pair content; use separate agent instances for
  concurrency.
- Streaming operations (`streamText`, `streamObject`) are not wrapped
  yet: their spans are recorded flat (each LLM call its own single-span
  trace), since the stream lifecycle does not fit the open/close-at-resolve
  root cleanly.
- The root `agent_step` span is recorded at completion (not opened as
  `running` first), so no span-update path or extra index is needed. LLM
  child spans still stream in live during the call; the root caps the tree
  at the end.
- Adapter-sourced `llm` spans have `startedAt == endedAt` and no
  `latencyMs`: the agent's `usageHandler` is a post-response hook with no
  call-start time, so per-call latency is not observable from it. Spans
  recorded through the generic `recordSpan` API can set real `startedAt`,
  `endedAt`, and `latencyMs` themselves.

## Verifying locally

With the local backend running (`pnpm local:start`) and the example
deployed (`npx convex dev --once`):

- `node example/live-proof.mjs` proves the generic API: a span tree fills
  in live over a subscription.
- `node example/agent-proof.mjs` proves the adapter end to end with a real
  agent call (needs `ANTHROPIC_API_KEY` set on the backend via
  `npx convex env set`).
