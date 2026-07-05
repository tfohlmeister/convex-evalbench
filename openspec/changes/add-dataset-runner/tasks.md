## 1. Schema and shared types

- [ ] 1.1 Add the `eval_datasets`, `eval_dataset_items`, `eval_runs`, and
  `eval_results` tables to `src/component/schema.ts` with the fields and
  indexes from design D1 (`by_name`, `by_dataset`, `by_status`, `by_run`,
  `by_run_item`).
- [ ] 1.2 Add isomorphic types and validators to `src/shared.ts`: run
  `status`, result `status`, the score record (`{ scorer, score, passed,
  details? }`), the run config shape (selected scorers, `concurrency`,
  `passThreshold`), and the target return shape (`{ output, traceId? }`).
- [ ] 1.3 Run codegen (`pnpm run build:codegen`) so `_generated` reflects
  the new tables; confirm `pnpm check` is green.

## 2. Dataset storage and CRUD

- [ ] 2.1 Implement component functions in `src/component/datasets.ts`:
  create dataset (optionally with items), add items, list datasets
  (archived filter), list items, version (snapshot copying items), archive.
  Maintain `itemCount`.
- [ ] 2.2 Add `Evalbench` client methods: `createDataset`, `addItems`,
  `listDatasets`, `listItems`, `versionDataset`, `archiveDataset`.
- [ ] 2.3 Add convex-test tests for dataset CRUD: create with/without
  items, add and list items (no cross-dataset leakage), version snapshot
  copies items and links parent, archive hides from default listing. Keep
  `pnpm check` green.

## 3. Scorers (deterministic built-ins)

- [ ] 3.1 Add the eval-free JSON Schema validator dependency
  (`@cfworker/json-schema`, per design D6) and confirm it runs in the V8
  runtime (no `eval`/`new Function`).
- [ ] 3.2 Implement an isomorphic scorers module (`src/scorers.ts`): the
  scorer contract and the `exactMatch` and `jsonSchema` built-ins
  (score in `[0,1]`, `passed`, optional `details`). No Convex runtime
  imports.
- [ ] 3.3 Re-export the built-in scorers from the package root.
- [ ] 3.4 Add unit tests for the scorers: exactMatch equal/differing,
  jsonSchema valid/invalid (with error details). Keep `pnpm check` green.

## 4. Run storage and the claim seam

- [ ] 4.1 Implement run/result writes in `src/component/runner.ts`: create a
  run plus one pending `eval_results` row per item; the claim mutation
  (pending -> running, returns the result and its item); the result-finalize
  mutation (write output/scores/passed/traceId/latency, bump run
  `completedCount`/`passedCount`/`summaryScore`, mark the run completed when
  the last item finishes).
- [ ] 4.2 Enforce idempotency: reject `startRun` re-entry on a non-terminal
  run; the claim transition guarantees an item is processed at most once;
  track `attempts`.
- [ ] 4.3 Add convex-test tests for the claim seam: one pending row per
  item, claim is single-winner, finalize updates counters, run completes
  when all items terminal. Keep `pnpm check` green.

## 5. Runner execution

- [ ] 5.1 Implement `startRun` (component action) and the worker action in
  `src/component/runner.ts`: resolve the target function handle, create the
  run and pending results, schedule `config.concurrency` workers via
  `ctx.scheduler`; each worker loops claim -> invoke target with
  `{ input, runId, itemId }` -> score with the selected scorers -> finalize.
- [ ] 5.2 Record a target failure as an `error` result (with `errorType`)
  and continue the run.
- [ ] 5.3 Add the `Evalbench.startRun(ctx, { datasetId, target, config })`
  client method (resolve `target` to a function handle via
  `createFunctionHandle`, mirroring the gateway tool pattern).
- [ ] 5.4 Add convex-test tests for the runner: a small dataset runs, each
  item is scored, a failing target item is recorded as error while others
  complete, and the run reaches `completed`. Keep `pnpm check` green.

## 6. Reactive queries and client API

- [ ] 6.1 Implement `runSummary({ runId })` (the single run row with
  maintained counts and aggregate score) and `listResults({ runId })`
  (per-item rows via `by_run`) as component queries.
- [ ] 6.2 Add `Evalbench.runSummary` and `Evalbench.listResults` client
  methods.
- [ ] 6.3 Add convex-test tests including one that finalizing another item
  changes the `runSummary` result (the live progress behavior). Keep
  `pnpm check` green.

## 7. Example verification

- [ ] 7.1 In `example/convex`, seed a small demo dataset and add a target
  action (it can reuse the wrapped demo agent or a deterministic stub),
  plus a host `startRun` trigger and host query wrappers for `runSummary`
  and `listResults`.
- [ ] 7.2 Add a backend live-proof script (mirroring
  `example/live-proof.mjs`) that subscribes to `runSummary`, starts a run,
  and asserts the completed/passed counts fill in live as items are scored
  and the run reaches `completed`.

## 8. Docs and final gate

- [ ] 8.1 Update README / `docs/` with the datasets, runner, and scorers
  surface (dataset CRUD, the target contract, the built-in scorers, the
  run summary query).
- [ ] 8.2 Final gate: `pnpm check` green and the example run proof passes.
