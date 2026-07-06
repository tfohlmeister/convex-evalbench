## Context

`eval_traces` holds one row per span and is the only unbounded-growth
table (production spans have no run to bound them). Content-recording
spans additionally store `input`/`output` above the inline threshold as
File Storage objects, referenced by `inputStorageId` / `outputStorageId`.
The existing indexes are all prefixed by another field (`traceId`,
`parentSpanId`, `runId`, `threadId`) plus `startedAt`, so none supports
an age-ordered scan across all spans. Recovery/maintenance in this
codebase is host-invoked (`redriveRun`), not a component-owned cron.

## Goals / Non-Goals

**Goals:**
- Delete trace spans older than a host-chosen age, in bounded batches.
- Delete each pruned span's File Storage content so nothing is orphaned.
- Let the host drive prune to completion and schedule it as it likes.

**Non-Goals:**
- Pruning runs/results/datasets; count/run-based retention; a
  component-owned cron; archival (prune is a hard delete).

## Decisions

### D1. Age scan over a new `by_started` index

Add `eval_traces.index("by_started", ["startedAt"])`. `pruneTraces`
queries `by_started` with `q.lt("startedAt", cutoff)` and `.take(limit)`,
so each batch reads only the oldest rows up to `limit`. Alternative
considered: reuse `by_parent_started`. Rejected: it is keyed by
`parentSpanId` first, so it cannot order all spans by age. The index is
additive and small (one number).

### D2. Cutoff and batch bounds

`olderThanMs` defaults to 30 days (`DEFAULT_TRACE_RETENTION_MS`), sane
against non-finite/negative host input (falls back to the default, as
`redriveRun` does for its cutoff). `limit` defaults to 200, capped at
1000, keeping one batch well within a mutation's document-write budget
even when every span also deletes two storage objects.

### D3. Prune is a paginated mutation, not an action

`ctx.storage.delete` is available in mutations, so deleting a span row
and its storage objects happens in one transaction; a batch cannot
leave a row deleted with its blob leaked (or vice versa). The mutation
returns `{ deleted, hasMore }` where `hasMore` is true when the batch
filled to `limit` (more may remain). The host loops until `hasMore` is
false. A mutation (not an action) also keeps each batch atomic and
re-runnable. Storage deletes for the batch's spans run before the row
deletes; a span with no stored content just deletes its row.

### D4. Host-invoked, like `redriveRun`

The component ships `pruneTraces`; the host calls it (a script, a button,
or the host's own cron). No component cron. This matches the codebase's
recovery/maintenance stance and keeps the retention policy in the host,
where the compliance decision belongs. The docs give a host-cron recipe.

### D5. Deletion granularity is the span, not the trace

Prune deletes individual spans older than the cutoff, not whole traces.
Spans of one trace share a `startedAt` neighborhood, so a trace is
normally pruned as a unit; a long-lived trace with a recent span keeps
that span. This avoids a second lookup (all spans of each trace) and
matches "reclaim old rows" rather than "reason about trace lifetimes".

## Risks / Trade-offs

- **A very large backlog needs many batches.** `hasMore` drives the
  loop; the host bounds throughput by batch size and call cadence.
  Documented.
- **Span-granular prune can split a trace across the cutoff boundary.**
  Acceptable: the tree query tolerates missing spans (it already
  assembles from whatever spans exist), and the boundary window is one
  retention period wide, so a split trace is old regardless.
- **Storage deletes are not transactional with the outside world.** If a
  batch mutation retries, `ctx.storage.delete` on an already-deleted id
  is a no-op, so retries are safe.

## Migration Plan

Additive: one new index on `eval_traces`, one new mutation, one client
method. No existing data changes; nothing prunes until a host calls
`pruneTraces`. `pnpm check` stays green; a convex-test proves the age
cutoff, the File Storage cascade, and the `hasMore` pagination.

## Open Questions

- Should `pruneTraces` also accept a `runId` filter to prune one run's
  spans? Deferred (out of scope: age-only this change).
