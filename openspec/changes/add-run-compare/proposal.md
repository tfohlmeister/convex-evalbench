## Why

Evals answer "how good is this version"; the missing third pillar is
"did this change make it worse". Comparing a candidate run against a
baseline run over the same dataset turns eval runs into a regression
gate: prompt or model changes can be blocked in CI before they ship,
which is the core promise of the project ("catch quality regressions
before they ship").

## What Changes

- Store each result's aggregate `itemScore` on the `eval_results` row
  at finalize time (it is already computed there and currently only
  folded into the run mean), so per-item deltas need no recomputation.
- Add a **reactive compare query**: given a baseline run and a
  candidate run over the same dataset, return the per-item join
  (item, baseline outcome, candidate outcome, score delta, regression
  flag) plus aggregate stats (pass rates, mean scores, regressed /
  improved / unchanged counts). Reactive: the comparison fills in live
  while the candidate run is still executing.
- Add a **gate evaluation**: a query that applies thresholds
  (max regressed items, min pass rate, max mean-score drop) to a
  comparison and returns a structured verdict with reasons, plus the
  documented CI pattern (a host action that throws on a failing
  verdict, so `npx convex run` exits non-zero).
- Add **`listRuns`**: runs of a dataset, newest first, so a CI script
  or UI can locate the baseline (e.g. latest completed run of a given
  `targetVersion`).
- Extend the `Evalbench` client with `compareRuns`, `evaluateGate`,
  and `listRuns`; example app and a backend proof comparing a baseline
  target against a deliberately regressed variant.

## Capabilities

### New Capabilities
- `run-compare`: per-item and aggregate comparison of two runs over
  the same dataset, the regression/improvement classification, and the
  threshold-based gate verdict for CI use.

### Modified Capabilities
- `eval-runner`: a finalized result SHALL record its aggregate item
  score (previously only folded into the run's `summaryScore`), and
  runs of a dataset SHALL be listable.

## Impact

- Component: `eval_results` gains an optional `itemScore` field
  (additive); `finalize` writes it; new `src/component/compare.ts`
  with the compare/gate/list queries.
- Client: `compareRuns`, `evaluateGate`, `listRuns` methods; no new
  exports-map entry.
- Example: a regressed-variant target, a compare proof script
  (`example/compare-proof.mjs`), docs (`docs/compare.md` or a section
  in `docs/evals.md`) including the CI-gate recipe.
- No new dependencies.

## Non-goals (deferred)

- Statistical significance testing (Bayesian or frequentist) on the
  deltas; Phase 4 reports raw counts and means.
- Automatic A/B traffic routing and drift-detection crons.
- Baseline bookkeeping beyond `listRuns` (no "pinned baseline" table).
- Comparing runs across different dataset versions (item sets differ;
  out of scope).
- Dashboard UI; the compare query is the data layer a UI would sit on.
