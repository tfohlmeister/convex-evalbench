## Context

Phases 1-3 shipped tracing, datasets, the runner, and the scorer
stack. Runs already store everything a comparison needs except one
number: `finalize` computes each item's aggregate score but only folds
it into the run's running mean. Results are keyed `(runId, itemId)`
and dataset versions are immutable, so two runs over the same
`datasetId` are directly joinable per item. Phase 4 builds the compare
and gate layer on that join; no new execution machinery is needed.

## Goals / Non-Goals

**Goals:**
- Per-item and aggregate comparison of two runs over the same dataset,
  reactive while the candidate is still executing.
- Deterministic regression / improvement classification per item.
- A threshold-based gate verdict usable as a CI pass/fail.
- `listRuns` so CI and UIs can locate a baseline run.

**Non-Goals:**
- Significance testing, A/B routing, drift crons, pinned-baseline
  bookkeeping, cross-dataset-version comparison, UI.

## Decisions

### D1. Store `itemScore` on the result at finalize

`eval_results` gains optional `itemScore` (additive). `finalize`
already receives it and now writes it alongside the terminal patch.
For rows finalized before this change, compare falls back to the mean
of the row's `scores` (and 0 for an `error` row), so the compare layer
works on historical runs too. Alternative considered: always compute
from `scores` on read. Rejected: the fallback duplicates aggregation
logic on every read and diverges once scoring semantics evolve; the
authoritative number is the one the run mean was built from.

### D2. Comparison is a per-item join over one dataset

`compareRuns({ baselineRunId, candidateRunId })` requires both runs to
reference the same `datasetId` (else `ConvexError`). Results of both
runs are loaded via `by_run` and joined on `itemId`. Per-item
classification:

- `regressed`: baseline passed, candidate terminal and not passed.
- `improved`: baseline not passed, candidate terminal and passed.
- `unchanged`: both terminal, same passed value.
- `incomplete`: either side not terminal (pending/running) or missing.

An `error` result has `passed: false` and score 0, so target failures
count as regressions when the baseline passed, which is the honest
reading for a gate.

### D3. One reactive query returns stats plus per-item rows

Return shape: `{ baseline, candidate, stats, items }` where
`baseline`/`candidate` are the run rows, `stats` carries
`regressed / improved / unchanged / incomplete` counts, both pass
counts and mean scores (over terminal items), and `items` is one lean
entry per dataset item: `{ itemId, baselineStatus, candidateStatus,
baselinePassed?, candidatePassed?, baselineScore?, candidateScore?,
scoreDelta?, classification }`. Raw outputs and score records stay in
`listResults` (drill-down), keeping the compare payload small. The
query is reactive: while the candidate run executes, finalize writes
move items from `incomplete` to a terminal classification and
subscribers see the comparison fill in live. Eval datasets are
bounded (hundreds, not millions, of items), so a full collect per run
is within query limits; documented as a limit.

### D4. Gate: thresholds over the same comparison

`evaluateGate({ baselineRunId, candidateRunId, thresholds? })` reuses
the compare computation and applies:

- `maxRegressedItems` (default 0),
- `minPassRate` (candidate pass rate over terminal items, optional),
- `maxScoreDrop` (baseline mean minus candidate mean, optional).

Verdict: `{ ok, reasons: string[], stats }`. A candidate run that is
not `completed` yields `ok: false` with reason
`"candidate run not completed"`, so a CI job that forgot to wait fails
loud instead of gating on partial data. The gate is a query
(deterministic, no side effects); throwing is the host's choice.

### D5. CI recipe: a throwing host action

Documented pattern: the host wraps the gate in a tiny action that
throws `ConvexError(reasons.join("; "))` when `ok` is false, and CI
runs `npx convex run evals:assertGate '{...}'`, which exits non-zero
on a thrown error. The component ships the verdict, not the throw, so
non-CI consumers (dashboards) can render the same data. The example
app includes this action and the proof script asserts both gate
outcomes (pass against an identical rerun, fail against the regressed
variant).

### D6. `listRuns` on the existing index

`listRuns({ datasetId, limit? })` reads `by_dataset` descending
(default 50, capped 200), returning run rows. Baseline selection
(e.g. "latest completed run with targetVersion X") happens host-side
over that list; no new index or table.

## Risks / Trade-offs

- **Large datasets inflate the compare payload.** One entry per item;
  at eval-scale (<= a few thousand items) this is fine, far below
  query limits. Mitigation: documented; pagination is the escape hatch
  if it ever bites.
- **Score comparability assumes same scorer config.** Comparing runs
  with different scorer sets yields deltas that mix meanings. The
  component compares whatever it is given (config equality is not
  enforced; hosts may intentionally evolve configs); the docs call out
  that gates should compare runs with identical scorer configs.
- **`itemScore` fallback duplicates the mean for legacy rows.** One
  small, tested function; removed once no pre-Phase-4 rows matter.

## Migration Plan

Additive only: one optional field on `eval_results` written by
`finalize` from now on, new component queries in `compare.ts`, new
client methods. Existing runs remain comparable via the D1 fallback.
Each task group keeps `pnpm check` green; the compare proof runs two
runs against the local backend and asserts both gate outcomes.

## Open Questions

- Should `stats` also break down mean score per scorer type for the
  drill-down? (Leaning no for Phase 4; `listResults` carries the
  per-scorer records.)
