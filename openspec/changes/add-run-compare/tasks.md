## 1. Result item score

- [ ] 1.1 Add optional `itemScore` to `eval_results` in
  `src/component/schema.ts` (additive) and to the `resultValidator` in
  `src/component/runner.ts`; write it in `finalizeResult` (the value is
  already passed in). Run codegen; `pnpm check` green.
- [ ] 1.2 Extend an existing finalize test to assert the stored
  `itemScore`.

## 2. Compare query

- [ ] 2.1 Implement `src/component/compare.ts`: `compareRuns({
  baselineRunId, candidateRunId })` per design D2/D3 (same-dataset
  guard, per-item join on `itemId`, classification
  regressed/improved/unchanged/incomplete, stats with pass counts and
  mean scores over terminal items, lean per-item entries with score
  delta; `itemScore ?? mean(scores)` fallback for legacy rows, 0 for
  error rows).
- [ ] 2.2 Add convex-test coverage: regressed/improved/unchanged
  classification, different-dataset rejection, and the live fill-in
  scenario (an item moves from incomplete to a terminal classification
  after a finalize, changing the compare result).

## 3. Gate and run listing

- [ ] 3.1 Implement `evaluateGate({ baselineRunId, candidateRunId,
  thresholds? })` in `src/component/compare.ts` per design D4
  (maxRegressedItems default 0, optional minPassRate and maxScoreDrop,
  incomplete-candidate reason, sanitized numeric thresholds).
- [ ] 3.2 Implement `listRuns({ datasetId, limit? })` via `by_dataset`
  descending (default 50, cap 200).
- [ ] 3.3 Add convex-test coverage: default gate fails on one
  regression and names the count, equal-or-better candidate passes,
  incomplete candidate fails with the explicit reason, threshold
  variants (minPassRate, maxScoreDrop), and `listRuns` ordering plus
  no cross-dataset leakage.

## 4. Client API

- [ ] 4.1 Add `Evalbench.compareRuns`, `Evalbench.evaluateGate`, and
  `Evalbench.listRuns` methods mirroring the existing pattern.
- [ ] 4.2 Cover the client wrappers via a test action (same pattern as
  `clientStartRun` in `targets.test.ts`).

## 5. Example verification

- [ ] 5.1 Extend `example/convex/evalDemo.ts` with a deliberately
  regressed target variant (e.g. uppercases everything except one
  input it now gets wrong) and an `assertGate` action that throws on a
  failing verdict (the documented CI pattern, design D5).
- [ ] 5.2 Add `example/compare-proof.mjs`: run baseline and regressed
  candidate over the same dataset, assert the compare classifies the
  regressed item, the gate fails against the regressed run and passes
  against an identical rerun, and `assertGate` throws for CI.

## 6. Docs and final gate

- [ ] 6.1 Document compare, gate, `listRuns`, and the CI recipe in
  `docs/evals.md` (or a new `docs/compare.md` linked from the README);
  update README status/roadmap (regression / A-B shipped).
- [ ] 6.2 Final gate: `pnpm check` green; all four proofs
  (`live-proof`, `eval-proof`, `judge-proof`, `compare-proof`) pass
  against the local backend.
