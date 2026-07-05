## Why

Phase 2 can only score deterministically (`exactMatch`, `jsonSchema`),
which covers structured outputs but not the common case of free-form
LLM output where "correct" is a semantic judgment. Judges
(LLM-as-judge) and semantic similarity close that gap, and a
host-registered scorer mechanism makes the scorer set extensible
without growing the component for every use case.

## What Changes

- Add **host-registered scorers**: `defineScorer` wraps a host action
  into a scorer with the standard contract; the client resolves scorer
  references to function handles at `startRun` (the same pattern as the
  run target), and the worker invokes them per item alongside the
  built-ins.
- Add **`embeddingSimilarity`**: cosine similarity between the target
  output and the expected output, using a host-provided embedder action
  (the component stays free of provider SDKs); passes against a
  configurable threshold.
- Add **`llmAsJudge`**: a helper that builds a judge scorer from a
  host-side LLM call plus a rubric prompt. Each judge verdict is
  recorded as a `kind: "judge"` span in the item's trace (stamped with
  the `runId`), so verdicts are observable like any other LLM call.
- Add **multi-judge consensus**: a run config can list several judges
  for one verdict; the item passes the judge scorer when a configurable
  majority passes.
- Extend the **run config and worker** to invoke async, handle-based
  scorers and to merge their score records with the deterministic ones.
- Add the **minimal stuck-row re-drive** deferred from Phase 2: a
  host-invoked recovery that re-claims results stuck in `running`
  (attempts-capped), as promised in docs/evals.md.

## Capabilities

### New Capabilities
- `custom-scorers`: host-registered scorer actions (`defineScorer`),
  handle resolution at `startRun`, the async scorer contract, and the
  `embeddingSimilarity` built-in on top of a host embedder.
- `judges`: the `llmAsJudge` scorer builder, judge verdicts traced as
  `judge` spans linked to the item's trace and run, and multi-judge
  consensus.

### Modified Capabilities
- `eval-runner`: the run config accepts handle-based scorer entries;
  scoring becomes async in the worker (deterministic scorers still run
  as before); a stuck `running` result can be re-driven by the host
  (bounded by `attempts`).

## Impact

- Component: `src/component/runner.ts` (async scorer invocation in the
  worker, re-drive mutation), `src/shared.ts` (scorer config and
  verdict validators), no new tables expected.
- Client: `defineScorer`, scorer-reference resolution in `startRun`,
  a re-drive client method; `llmAsJudge` and `embeddingSimilarity`
  exported from the package root.
- Example: a deterministic judge stub for the backend proof, plus an
  optional real-LLM judge wired to the existing Anthropic demo agent.
- No new runtime dependency expected (cosine is pure math; LLM and
  embedding calls live host-side behind function handles).

## Non-goals (deferred)

- Regression detection, A-B comparison, and significance testing.
- Automatic (cron-driven) re-drive or managed retry with backoff; the
  re-drive here is a host-invoked recovery primitive only.
- OTLP receiver, AI SDK middleware, dashboard app, retention/pruning.
- Bundling any LLM or embedding provider SDK into the component.
