## Why

Production trace spans accumulate forever: `eval_traces` is the one
table that grows unbounded with traffic, and content-recording spans
also hold File Storage objects. There is no way to reclaim that space,
and it is called out as a known limit. Hosts need a bounded-cost way to
drop old spans (and their stored content) on their own retention policy.

## What Changes

- Add a host-invoked **`pruneTraces({ olderThanMs?, limit? })`**
  mutation on the component: it deletes `eval_traces` rows whose span
  `startedAt` is older than the cutoff (default 30 days), in bounded
  batches, and **cascades** to delete each span's File Storage content
  objects (`inputStorageId` / `outputStorageId`) so nothing is
  orphaned. It returns `{ deleted, hasMore }` so the host loops until
  drained (manually or from its own cron), mirroring the existing
  `redriveRun` host-invoked pattern: the component ships the operation,
  the host decides when to run it.
- Add a **`by_started`** index on `eval_traces` (`["startedAt"]`), since
  no age-ordered index exists today; without it an age scan is a full
  table scan.
- Extend the `Evalbench` client with `pruneTraces`; document the prune
  loop and a host-cron recipe in `docs/tracing.md`.

## Capabilities

### Modified Capabilities
- `tracing`: trace spans SHALL be prunable by age, with their recorded
  File Storage content deleted alongside the span rows, in bounded
  batches a host can drive to completion.

## Impact

- Component: `eval_traces` gains a `by_started` index (additive); new
  `pruneTraces` mutation in `src/component/ingestion.ts` (or a small
  `retention.ts`).
- Client: `pruneTraces` method; no new exports-map entry.
- Docs: a retention section in `docs/tracing.md` with the loop and the
  host-cron recipe.
- No new dependencies. No schema field changes (index only).

## Non-goals (deferred)

- Pruning runs, results, or datasets (traces only this change).
- A component-owned cron that prunes automatically; the host schedules
  the loop (consistent with `redriveRun`).
- Retention by count, by run, or by any dimension other than span age.
- Compaction or archival to cold storage; prune is a hard delete.
