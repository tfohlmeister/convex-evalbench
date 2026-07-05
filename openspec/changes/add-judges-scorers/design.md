## Context

Phase 2 (`add-dataset-runner`, archived) shipped the eval engine with
deterministic scorers: the worker action claims items, invokes the
host's target via a function handle, scores synchronously with pure
functions, and finalizes counters. Phase 3 adds semantic scoring
(judges, embeddings) and host extensibility (`defineScorer`), plus the
stuck-row re-drive that Phase 2's docs explicitly deferred to this
phase.

Constraints that shape this design:

- The component must stay free of LLM and embedding provider SDKs; the
  host owns model access (same philosophy as "the host owns auth").
  All provider I/O therefore happens in host actions reached via
  function handles, exactly like the Phase 2 run target (design D2
  there).
- Scoring with I/O cannot run in the finalize mutation; it must happen
  in the worker action between target invocation and finalize. The
  Phase 2 worker already has that seam (`scoreOutput` is called in the
  action).
- Judge verdicts should be observable like any LLM call: the `judge`
  span kind has existed in the tracing schema since Phase 1 for exactly
  this purpose.

## Goals / Non-Goals

**Goals:**
- Host-registered scorer actions with the standard verdict contract
  (`defineScorer`), invoked per item by the worker.
- `embeddingSimilarity` via a host-provided embedder action plus
  in-component cosine.
- `llmAsJudge` builder producing judge scorers whose verdicts are
  traced as `judge` spans in the item's trace, stamped with the run.
- Multi-judge consensus with a configurable quorum.
- Host-invoked stuck-row re-drive bounded by `attempts`.

**Non-Goals:**
- Automatic re-drive (cron) or managed retry/backoff.
- Regression / A-B, significance testing, dashboards, retention.
- Any provider SDK dependency in the component.

## Decisions

### D1. Async scorers are host actions behind function handles

A handle-based scorer is a host **action** with the contract
`{ input, output, expectedOutput?, runId, itemId, traceId?, config? }
-> { score: number; passed: boolean; details? }` (score in [0, 1],
same verdict shape as Phase 2's pure scorers). The client resolves
scorer function references to handles at `startRun` (mirroring the
target) and stores them in the run config; the worker invokes them via
`ctx.runAction(handle, ...)` after the target returns, passing the
item's `traceId` so the scorer can attach spans to the item's trace.

Alternative considered: running judges inside the component with a
host-supplied API key. Rejected: pulls provider SDKs into the
component, breaks the "host owns model access" rule, and couples the
component to SDK churn.

### D2. Run config grows three handle-based scorer entries

`scorerConfigValidator` (shared.ts) gains, alongside `exactMatch` and
`jsonSchema`:

- `{ type: "custom", name, handle, config? }`: one host scorer.
- `{ type: "embeddingSimilarity", embedderHandle, threshold? }`
  (default threshold 0.8): the worker calls the embedder action
  (`{ texts: string[] } -> number[][]`) with `[output, expectedOutput]`
  and computes cosine in the component (pure math in `src/scorers.ts`).
  Non-string output or missing `expectedOutput` fails the scorer with
  a `details` reason instead of throwing.
- `{ type: "consensus", name?, judgeHandles: string[], quorum? }`:
  the worker invokes every judge handle (in parallel via
  `Promise.all`), `passed = passCount >= quorum` (default: strict
  majority), `score = mean of judge scores`, `details` carries the
  per-judge verdicts.

The host-facing `startRun` API takes `FunctionReference`s
(`scorer: { type: "custom", fn: internal.evals.myScorer, ... }`); the
client maps refs to handles before calling the component, so the
stored config is plain strings, like `targetHandle`.

### D3. `defineScorer` is a thin host-side action factory

`defineScorer({ name, handler })` returns a Convex action definition
(built with the host's `action` builder passed in, or documented as a
plain wrapper) whose args/returns validators enforce the D1 contract,
so hosts cannot register a shape-incompatible scorer. It adds no
registry table: registration is per-run via the config (declarative,
like the target). A persistent scorer registry can come later if
needed.

### D4. `llmAsJudge` builds a judge scorer, host executes the LLM call

`llmAsJudge({ name, rubric, generate, evalbench?, recordVerdictSpan })`
returns a `defineScorer` handler that:

1. Builds the judge prompt from the rubric plus the item's `input`,
   `output`, and `expectedOutput`.
2. Calls `generate(prompt)`, a host-supplied `(prompt: string) =>
   Promise<string>` (typically wrapping the AI SDK), keeping the
   component SDK-free.
3. Parses the verdict: the prompt instructs the model to answer with
   JSON `{ "pass": boolean, "score": number, "reasoning": string }`;
   a parse failure yields `{ score: 0, passed: false, details:
   { parseError, raw } }` rather than throwing.
4. When an `Evalbench` instance is provided, records a `kind: "judge"`
   span into the item's `traceId` (falling back to its own trace when
   the target returned none), stamped with the `runId`, carrying the
   judge name as `operationName` and the verdict in `metadata`;
   `recordContent`-style opt-in controls whether prompt/verdict text is
   stored.

Alternative considered: a fixed judge implementation in the component
calling a configurable HTTP endpoint. Rejected: reinvents provider
routing that the host's AI SDK already does better.

### D5. Consensus semantics

Consensus is one score record (scorer name defaults to `consensus`).
Quorum defaults to `floor(n/2) + 1`. Judges run in parallel inside the
worker; one judge throwing counts as a failed vote (recorded in
`details`), it does not error the item. Rationale: a panel exists
precisely to tolerate individual judge flakiness.

### D6. Stuck-row re-drive (host-invoked, attempts-capped)

`eval_results` gains `claimedAt: v.optional(v.number())`, set by
`claimNext` (additive schema change). A new public mutation
`redriveRun({ runId, olderThanMs? })` (default 10 minutes):

- `running` results with `claimedAt` older than the cutoff and
  `attempts < maxAttempts` (config, default 3) go back to `pending`.
- Those at the attempts cap are finalized as `error`
  (`errorType: "max_attempts"`), through the same counter-bumping path
  as any finalize.
- If anything was re-pended and the run is still `running`, the
  mutation schedules a worker (atomic, since it is a mutation).

Client method `Evalbench.redriveRun(ctx, runId, opts?)`. Host decides
when to call it (manually or from its own cron); the component stays
free of background work.

### D7. Worker scoring pipeline

`scoreOutput` stays pure for the deterministic scorers. The worker
partitions the config: pure scorers run synchronously, handle-based
scorers are awaited (consensus fans out with `Promise.all`); all score
records merge into one array, `passed = every scorer passed`,
`itemScore = mean` (unchanged aggregation). A handle scorer that
throws (outside a consensus panel) yields a failed score record with
`details.error`, not an `error` result: the target succeeded, so the
output and remaining scores are still worth keeping.

### D8. Client and package surface

- `Evalbench.startRun` accepts the extended config with
  `FunctionReference`s and resolves handles.
- `Evalbench.redriveRun` added.
- Package root exports: `defineScorer`, `llmAsJudge`,
  `embeddingSimilarity` helpers (`cosineSimilarity` stays internal to
  `src/scorers.ts`).
- No new exports-map entry.

## Risks / Trade-offs

- **Judge cost and nondeterminism.** A judge is an LLM call per item
  (times panel size). Mitigation: judges are opt-in per run config;
  verdicts are traced as spans so cost is observable; consensus
  tolerates single-judge flakiness.
- **Embedder contract friction.** Hosts must expose a
  `{ texts } -> number[][]` action. Mitigation: the contract is tiny
  and documented with an AI SDK example; a mismatched shape fails the
  scorer with details, not the item.
- **Handle scorers lengthen worker items.** A slow judge eats the
  worker time budget. Mitigation: the Phase 2 time-budget plus
  successor scheduling already bounds this; concurrency is capped.
- **Re-drive can double-invoke a target** (worker crashed after the
  target call but before finalize; the re-driven item calls the target
  again). Accepted: at-most-once applies to *scoring*, targets must
  tolerate re-invocation (documented); exactly-once stays out of
  scope.
- **Two config shapes (refs host-side, handles stored).** Mitigation:
  the mapping lives in one place (`startRun` client method) and is
  type-enforced.

## Migration Plan

Additive throughout: one optional field on `eval_results`
(`claimedAt`), a widened scorer-config union, new client methods and
root exports. No changes to existing rows or Phase 2 behavior; a run
config without new scorer types behaves exactly as today. Each task
group keeps `pnpm check` green; the example proof gains a judge-stub
run.

## Open Questions

- Should `llmAsJudge` verdict parsing accept a bare "PASS"/"FAIL" text
  fallback in addition to the JSON contract? (Leaning yes as a
  lenient fallback, recorded in `details.parsedFrom`.)
- Default `olderThanMs` for `redriveRun`: 10 minutes matches the
  action limit; is that too aggressive for slow LLM targets? (Leaning
  10 min default, host-overridable.)
