## Why

Phase 1 made LLM calls observable (traces), but observability alone cannot
tell you whether a prompt or model change improved or regressed quality.
The next step is repeatable evaluation: keep a fixed dataset of inputs with
expected outputs, run the system under test against all of them, and score
the results into a measurable pass rate. That is the unit-test equivalent
for non-deterministic AI and the foundation Phase 3 judges and the
regression / A-B layer build on.

## What Changes

- Add dataset storage: `eval_datasets` (versioned) and `eval_dataset_items`
  tables, with CRUD on the `Evalbench` client (create dataset, add and list
  items, snapshot a new version, archive).
- Add run storage: `eval_runs` (lifecycle, config, summary) and
  `eval_results` (one row per item, idempotent by `runId` + `itemId`)
  tables.
- Add a `startRun` action that runs a host-registered target function over
  each dataset item with bounded parallelism (in-component, via the Convex
  scheduler; no external Workpool dependency), scores each output, and
  writes an idempotent `eval_results` row.
- Add built-in deterministic scorers: `exactMatch` and `jsonSchema`. Each
  produces a numeric score and a pass/fail against the run's threshold.
- Link results to Phase 1 traces: the runner stamps each run with a `runId`
  (already carried on the `eval_traces` span schema) and records each
  result's `traceId`, so a result opens its trace tree.
- Add reactive queries: a run summary (item counts, pass rate, aggregate
  score) and a per-run results list, so a run renders live as items
  complete.
- Extend the `Evalbench` client with the dataset, run, and result methods,
  mirroring the existing method pattern. No new exports-map entry is needed
  (these are methods on `Evalbench`).

## Capabilities

### New Capabilities
- `datasets`: versioned evaluation datasets and their items. Create, list,
  version, and archive datasets; add and list items with optional
  `expectedOutput`, tags, and slice. The source of truth for what a run
  evaluates.
- `eval-runner`: run a host-registered target over a dataset with bounded
  parallelism, score each result with the built-in deterministic scorers,
  write idempotent per-item results linked to traces, and expose a reactive
  run summary. Includes the scoring contract and the `exactMatch` and
  `jsonSchema` built-ins.

### Modified Capabilities
None. The Phase 1 capabilities (`tracing`, `convex-agent-adapter`) are
unchanged. The runner reuses the existing `eval_traces.runId` field, which
Phase 1 added specifically to avoid a later migration, so no tracing
requirement changes.

## Impact

- Component: `src/component/schema.ts` gains four tables and their indexes;
  new function files for datasets, the runner, results queries, and the
  scorers. Run execution uses `ctx.scheduler` for bounded fan-out.
- Client: `src/client/index.ts` gains dataset, run, and result methods.
- Scorers: a new isomorphic scorers module. `jsonSchema` needs a JSON
  Schema validator that runs in Convex's V8 runtime, which forbids dynamic
  code evaluation (`eval` / `new Function`); ajv's default compiled mode
  does not run there, so an eval-free / interpreted validator (candidate:
  `@cfworker/json-schema`) is used instead. To be locked in design.
- Example: `example/convex` gains a demo dataset, a target function, a
  `startRun` trigger, and a backend proof that a run scores items and
  summarizes live.

## Non-goals (deferred to later phases)

- Judges (`llmAsJudge`, multi-judge consensus) and the
  `embeddingSimilarity` scorer (Phase 3).
- Custom host-registered scorers via `defineScorer` (Phase 3).
- Regression detection, A-B comparison views, and significance testing.
- Cross-deployment runs (invoking a production deployment over HTTP) and
  retention / pruning of old runs and results.
- A full dashboard. Phase 2 ships a backend-level proof plus the reactive
  summary query, not a UI.
