## 1. Shared types and scorer config

- [x] 1.1 Extend `scorerConfigValidator` in `src/shared.ts` with the
  handle-based entries from design D2 (`custom`, `embeddingSimilarity`
  with default threshold 0.8, `consensus` with quorum), plus the async
  scorer contract validators (`scorerArgs`, verdict shape) shared by
  `defineScorer` and the worker.
- [x] 1.2 Add `claimedAt` to `eval_results` in
  `src/component/schema.ts` (optional number, additive) and a
  `maxAttempts` field to the run config validator (default 3).
- [x] 1.3 Run codegen (`pnpm run build:codegen`); confirm `pnpm check`
  is green.

## 2. Cosine and embeddingSimilarity core

- [x] 2.1 Add `cosineSimilarity` (pure, internal) and the
  `embeddingSimilarity` verdict logic to `src/scorers.ts`: given two
  embedding vectors and a threshold, produce `{ score, passed }`;
  non-string inputs or a missing expected output produce a failing
  verdict with a `details` reason (design D2). Unit tests for equal,
  orthogonal, and graceful-failure cases.

## 3. defineScorer and client config resolution

- [x] 3.1 Implement `defineScorer` in the client (design D3): wraps a
  host handler into an action definition with args/returns validators
  enforcing the D1 contract; export from the package root.
- [x] 3.2 Extend `Evalbench.startRun` to accept function references
  for `custom`, `embeddingSimilarity` (embedder), and `consensus`
  (judges) entries and resolve them to handles via
  `createFunctionHandle` before calling the component (design D8).
- [x] 3.3 Add convex-test coverage: a `defineScorer`-built scorer in a
  test module is invoked per item through the full run path and its
  verdict lands on the result (custom-scorers spec, scenarios 1-3).

## 4. Worker scoring pipeline

- [x] 4.1 Extend the worker in `src/component/runner.ts` (design D7):
  partition config into pure and handle-based scorers, invoke handles
  with `{ input, output, expectedOutput?, runId, itemId, traceId?,
  config? }`, merge all score records, keep `passed = every` and
  `itemScore = mean`.
- [x] 4.2 Scorer-failure isolation: a throwing handle scorer yields a
  failing score record with `details.error`, not an `error` result;
  test with one throwing and one passing scorer on the same item.
- [x] 4.3 Implement `embeddingSimilarity` in the worker: call the
  embedder handle with `[output, expectedOutput]`, compute cosine
  in-component; tests for pass, fail, and non-string graceful failure
  against a deterministic test embedder action.
- [x] 4.4 Implement `consensus` in the worker: invoke all judge
  handles via `Promise.all`, quorum default strict majority, mean
  score, per-judge verdicts in details, a throwing judge counts as a
  failed vote; tests for majority-pass and throwing-judge scenarios.

## 5. llmAsJudge

- [x] 5.1 Implement `llmAsJudge` in the client (design D4): prompt
  builder from rubric + input/output/expectedOutput, JSON verdict
  parsing with the lenient PASS/FAIL fallback, parse failure yields a
  failing verdict with raw response in details; export from the
  package root.
- [x] 5.2 Judge span recording: with an `Evalbench` instance provided,
  record a `kind: "judge"` span into the item's trace (own trace when
  none), stamped with `runId`, judge name as `operationName`, verdict
  in `metadata`; content recording opt-in.
- [x] 5.3 Unit-test the prompt builder and verdict parsing (valid
  JSON, lenient fallback, garbage), and convex-test the judge span
  landing in the item's trace via a stub `generate`.

## 6. Stuck-row re-drive

- [x] 6.1 Set `claimedAt` in `claimNext`; implement the public
  `redriveRun({ runId, olderThanMs? })` mutation (design D6):
  re-pend stuck rows below the attempts cap, finalize capped rows as
  `error` (`errorType: "max_attempts"`) through the counter path,
  schedule a worker when anything was re-pended.
- [x] 6.2 Add `Evalbench.redriveRun` client method.
- [x] 6.3 Convex-test the three re-drive spec scenarios: stuck item
  re-driven to completion, attempts cap converts to error and the run
  completes, fresh/terminal rows untouched.

## 7. Example verification

- [x] 7.1 Extend `example/convex` with a deterministic judge stub
  (`generate` that returns a canned JSON verdict), an embedder stub,
  and a run wiring `exactMatch` + consensus panel + embeddingSimilarity
  over the demo dataset.
- [x] 7.2 Add `example/judge-proof.mjs`: run the judge-panel eval
  against the local backend and assert the consensus verdicts land on
  results, judge spans appear in the item traces (via `listSpans`,
  `kind: "judge"`, run-stamped), and the summary completes live.

## 8. Docs and final gate

- [x] 8.1 Update `docs/evals.md` (scorer contract, defineScorer,
  llmAsJudge with a real AI SDK example, embedder contract, consensus,
  re-drive) and the README (evals section + roadmap: judges shipped).
- [x] 8.2 Final gate: `pnpm check` green; `eval-proof.mjs`,
  `judge-proof.mjs`, and `live-proof.mjs` all pass against the local
  backend.
