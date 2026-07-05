## Context

Phase 1 (`add-tracing-core`, archived) shipped the tracing core: the
`eval_traces` table (which already carries an optional `runId`, added then
to avoid this migration), the single ingestion write seam, the `Evalbench`
client, and the `withEvalbench` adapter. Phase 2 adds the eval engine on
top: datasets, a runner, deterministic scorers, and results that link back
to traces. See `proposal.md` for motivation.

Constraints that shape this design:

- Component functions run in Convex's V8 runtime, which forbids dynamic
  code evaluation (`eval`, `new Function`). This rules out ajv's default
  compiled mode for the `jsonSchema` scorer.
- Phase 1 dropped the `@convex-dev/workpool` dependency (decision D7 there)
  and the project treats the handover's "locked decisions" as soft: take a
  dependency only for a real constraint, otherwise roll the equivalent
  in-component. Bounded run parallelism is not a hard constraint that
  requires Workpool.
- Conventions mirror `convex-mcp-gateway`: domain-split component function
  files, a host handle class whose methods call
  `ctx.run{Query,Mutation,Action}(this.component.<file>.<fn>, ...)`,
  function references resolved to handles via `createFunctionHandle`
  (as the gateway does for tools), best-effort writes, type-safe
  registration.

## Goals / Non-Goals

**Goals:**
- Store versioned datasets and items.
- Run a host-registered target over a dataset with bounded parallelism, no
  external Workpool dependency.
- Score each result with built-in deterministic scorers (`exactMatch`,
  `jsonSchema`) that run in the V8 runtime.
- Idempotent per-item results (a re-driven run never double-scores an item).
- Link each result to its Phase 1 trace; expose a reactive run summary and
  results list.

**Non-Goals:**
- Judges, `embeddingSimilarity`, and `defineScorer` (Phase 3).
- Regression / A-B comparison and significance testing.
- Cross-deployment runs, retention / pruning, a dashboard UI.

## Decisions

### D1. Data model: four tables

`eval_datasets` (a row is one dataset version):
- `name` (string), `version` (number, monotonic per name),
  `parentVersionId?` (`v.id("eval_datasets")` for lineage),
  `description?`, `itemCount` (number, denormalized), `archived` (boolean).
- Index `by_name` on `["name", "version"]`.

`eval_dataset_items`:
- `datasetId` (`v.id("eval_datasets")`), `input` (`v.any()`),
  `expectedOutput?` (`v.any()`), `expectedTools?` (array of string),
  `tags?` (array of string), `slice?` (string).
- Index `by_dataset` on `["datasetId"]`.

`eval_runs`:
- `datasetId`, `targetVersion?` (label of the system under test, e.g.
  "prompt-v2"), `targetEnv?`, `triggeredBy?`, `status`
  (`queued | running | completed | failed | canceled`), `config`
  (`v.any()`: selected scorers, `concurrency`, `passThreshold`),
  `itemCount`, `completedCount`, `passedCount`, `summaryScore?`,
  `startedAt`, `completedAt?`.
- Index `by_dataset` on `["datasetId", "startedAt"]`; `by_status` on
  `["status", "startedAt"]`.

`eval_results` (one row per run item):
- `runId` (`v.id("eval_runs")`), `itemId` (`v.id("eval_dataset_items")`),
  `status` (`pending | running | success | error`), `output?` (`v.any()`),
  `scores?` (array of `{ scorer, score, passed, details? }`), `passed?`,
  `traceId?`, `latencyMs?`, `costUsd?`, `errorType?`, `attempts` (number).
- Index `by_run` on `["runId", "status"]` (claim and list);
  `by_run_item` on `["runId", "itemId"]` (idempotency lookup).

Rationale: flat tables with denormalized counters keep the summary read to
one row (the run) while results stream individually. `runId`/`itemId` as
ids plus the `by_run_item` index give per-item idempotency without a unique
constraint (Convex has none).

### D2. The target is a host-provided function reference

`startRun(ctx, { datasetId, target, config })` takes `target`, a Convex
action reference (the system under test). The client resolves it to a
function handle with `createFunctionHandle` (the same pattern the gateway
uses for tools) and stores it on the run. The runner invokes the handle
per item with `{ input, runId, itemId }` and expects
`{ output: any; traceId?: string }` back.

Passing `runId` lets the target stamp its spans with that run id (the
`eval_traces.runId` field), so a result's trace is correlated; the returned
`traceId` records which trace to open from the result. An action (not a
query/mutation) is required because the target typically calls an LLM.
Alternative considered: register targets by name ahead of time (like
tools). Rejected as unnecessary indirection for Phase 2; a direct reference
at `startRun` is simpler and declarative.

### D3. Bounded parallelism in-component via a claim pattern (no Workpool)

`startRun` is a single mutation: it creates the run, pre-creates one
`pending` `eval_results` row per item, and schedules
`config.concurrency` worker actions with `ctx.scheduler.runAfter(0,
...)` in the same transaction, so a run row can never commit without
its workers being scheduled (Convex guarantees scheduling atomicity for
mutations, not actions). Each worker loops:

1. Claim the next item: a mutation reads one `pending` result for the run
   via `by_run`, patches it to `running`, and returns it with its item.
   Convex mutations are serializable, so two workers cannot claim the same
   row (OCC retries the loser).
2. Invoke the target handle with the item input.
3. Score the output and patch the result to `success`/`error` with scores,
   `passed`, `traceId`, latency; bump the run's `completedCount` /
   `passedCount` / running `summaryScore`.
4. Repeat until no `pending` row remains; the worker that completes the
   last item marks the run `completed`. A worker that exhausts its time
   budget (well under Convex's 10-minute action limit) schedules a
   successor worker and exits, so large datasets are not bounded by one
   action's wall clock.

This bounds concurrency to the worker count with no dependency. Trade-off:
Workpool would add managed retries, backoff, and global rate limits for
free; the claim pattern has none of those (a failed item is recorded as
`error`, not retried beyond `attempts`). For Phase 2 that is acceptable and
keeps the dependency surface small; if managed retry/rate-limiting becomes
a real need, the claim mutation is the seam to add it behind (or adopt
Workpool then). Alternative considered: process all items in one `startRun`
action with `Promise.all` batches. Rejected: a single action has a wall
clock limit, so large datasets would time out; scheduled workers each get
their own budget and survive restarts.

### D4. Idempotency

Per-item: the pre-created `pending` row plus the claim transition
(`pending` -> `running`) means an item is processed at most once even if
extra workers run. Each `startRun` call creates a fresh, independent
run; an existing run cannot be re-entered because `claimNext` hands out
work only while its run is `running`, and `finalize` leaves terminal
results (and their counters) untouched, so re-driving execution never
re-scores an item. A worker that crashes mid-item leaves a `running`
row (`attempts` records the claim count); a timed stuck-row re-drive is
deliberately deferred to Phase 3 together with managed retries, and the
claim mutation is the seam it will land behind.

### D5. Scoring contract and built-in scorers

A scorer is a pure function
`(args: { output, expectedOutput?, item, config }) => { score: number;
passed: boolean; details?: unknown }`, score in `[0, 1]`. It lives in an
isomorphic module (no Convex runtime imports), so it is unit-testable
directly and reusable client- and component-side.

Built-ins:
- `exactMatch`: deep-equals `output` against `item.expectedOutput`; score
  1/0, `passed = score === 1`.
- `jsonSchema`: validates `output` against the schema in the scorer config;
  score 1 when valid, 0 otherwise, `details` carries the validation errors.

Run config lists the scorers to apply, e.g.
`{ scorers: [{ type: "exactMatch" }, { type: "jsonSchema", schema }],
passThreshold?: number, concurrency: number }`. A result's overall
`passed` is true when every applied scorer passes (Phase 3 can generalize
to thresholds / weights). The fixed built-in set is intentional;
`defineScorer` (host-registered scorers) is Phase 3.

### D6. JSON Schema validation must be eval-free

`jsonSchema` uses an interpreted, eval-free validator
(`@cfworker/json-schema`, built for Cloudflare Workers, which share the
no-`eval` constraint), not ajv. ajv's default mode compiles schemas with
`new Function`, which throws in Convex's V8 runtime; ajv standalone mode is
build-time codegen and does not fit a runtime, host-supplied schema. This
is the one new dependency Phase 2 takes, and it is a real constraint (the
runtime), consistent with the "dependency only for a real need" rule.

### D7. Reactive run summary from maintained counters

The summary query returns the single `eval_runs` row (status, itemCount,
completedCount, passedCount, summaryScore), which workers update
incrementally, so the summary read is O(1) and updates live as items
finish. A separate `listResults(runId)` query streams per-item rows via
`by_run`. This resolves the Phase 1 open question (precomputed summary vs
client-side aggregation) in favor of maintained counters, matching the
handover's "aggregate metrics per run so the summary reads one row."
Trade-off: counter updates contend on the single run row; at Phase 2
volumes and worker counts this is negligible, and the counters are bumped
in the same mutation that writes each result.

### D8. Client API surface

`Evalbench` gains: `createDataset`, `addItems`, `listDatasets`,
`listItems`, `versionDataset`, `archiveDataset`, `startRun`, `runSummary`,
`listResults`. Methods mirror the existing pattern
(`ctx.run*(this.component.<file>.<fn>, ...)`). No new exports-map entry;
the built-in scorers are also re-exported from the package root for hosts
that want to score outside a run.

## Risks / Trade-offs

- **No managed retries / rate limiting (claim pattern).** A target failure
  is recorded as `error`, not retried beyond a minimal stuck-row re-drive.
  Mitigation: the claim mutation is the single seam to add retry/backoff or
  swap in Workpool later, without changing callers.
- **Counter contention on the run row.** Many workers bump the same
  `eval_runs` row. Mitigation: bounded `concurrency`; updates piggyback on
  the result-write mutation. If it bites, shard counters or recompute the
  summary from results on read.
- **`@cfworker/json-schema` capability gap.** It targets a JSON Schema
  draft that may not cover every keyword a host expects. Mitigation:
  document the supported draft; `defineScorer` (Phase 3) lets hosts bring
  their own validator if needed.
- **Target contract coupling.** Hosts must adapt their system under test to
  the `{ input, runId, itemId } -> { output, traceId? }` shape. Mitigation:
  the shape is small and documented; a thin wrapper action suffices.
- **Idempotency under worker crashes.** A crash can leave a `running` row
  and the run incomplete. Accepted for Phase 2 (documented in
  docs/evals.md Limits); the timed stuck-row re-drive with an `attempts`
  cap arrives with the Phase 3 retry work. Full exactly-once semantics
  are out of scope.

## Migration Plan

Additive: four new tables, no change to `eval_traces` (the `runId` field is
already present). Each task keeps `pnpm check` green at every committable
step: schema and dataset CRUD first (verifiable on their own), then the
scorers (pure, unit-tested), then the runner, then the example proof.
Rollback is removing the change; nothing depends on the new tables yet.

## Open Questions

- Dataset item input/output size: do items reuse the Phase 1 File Storage
  threshold for large `input`/`expectedOutput`, or stay inline for Phase 2?
  (Leaning inline now; items are typically small. Revisit if real datasets
  carry large fixtures.)
- Should `runSummary` include a per-scorer breakdown (mean score per
  scorer) or only the overall aggregate? (Leaning overall for MVP, with the
  per-result `scores` array available via `listResults`.)
- Stuck-row re-drive trigger: a host-driven cron (like the gateway's prune
  helpers) versus an automatic timeout inside the worker loop. (Leaning
  host-driven to keep the component free of background work.)
