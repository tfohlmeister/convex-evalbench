## 1. Index and constant

- [x] 1.1 Add a `by_started` index (`["startedAt"]`) to `eval_traces` in
  `src/component/schema.ts`, and a `DEFAULT_TRACE_RETENTION_MS`
  (30 days) constant in `src/shared.ts` next to the other runner
  defaults. Run codegen; `pnpm check` green.

## 2. Prune mutation

- [x] 2.1 Implement `pruneTraces({ olderThanMs?, limit? })` in
  `src/component/ingestion.ts` per design D1-D3: age scan via
  `by_started` with `q.lt("startedAt", cutoff)` and `.take(limit)`,
  sane cutoff (default `DEFAULT_TRACE_RETENTION_MS`, fallback on
  non-finite/negative) and limit (default 200, cap 1000); for each span
  delete `inputStorageId`/`outputStorageId` from `ctx.storage` when set,
  then delete the row; return `{ deleted, hasMore }` where `hasMore` is
  the batch filling to `limit`.
- [x] 2.2 Add convex-test coverage: spans older than the cutoff are
  deleted and newer ones kept; a pruned span's File Storage object is
  deleted (assert `ctx.storage` no longer holds it); `hasMore` is true
  when the batch fills and looping drains the backlog.

## 3. Client and docs

- [x] 3.1 Add an `Evalbench.pruneTraces(ctx, { olderThanMs?, limit? })`
  client wrapper mirroring the existing pattern.
- [x] 3.2 Cover the client wrapper via a test action (same pattern as
  the other client-wrapper tests).
- [x] 3.3 Document the prune loop and a host-cron recipe in
  `docs/tracing.md`; update the README retention note in the roadmap.

## 4. Final gate

- [x] 4.1 Final gate: `pnpm check` green; the new prune test passes and
  the existing trace/eval proofs still pass against the local backend.
