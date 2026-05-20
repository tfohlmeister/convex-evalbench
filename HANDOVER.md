# convex-evalbench: Handover

A reactive LLM eval, tracing, and regression layer packaged as a single
Convex Component. This document is the starting point for planning the
build out (intended to be turned into OpenSpec specs). It captures what
the project is, the decisions already locked in, the architecture sketch,
and a phase plan.

## Status

Foundation complete. The repository builds, type-checks, tests, and lints
green (`pnpm check`) with an empty component. No data model or feature
code is committed yet, on purpose: the data model and API are to be
designed in OpenSpec before implementation.

## What it is

"Tests plus observability for the quality of your AI." When you build an
app with an LLM or agent, output is non-deterministic and you have no
equivalent of a unit test. Change a prompt or swap a model and you cannot
tell whether quality went up or down. evalbench closes that gap with
three capabilities:

1. **Tracing** of every LLM call: input, output, tokens, cost, latency,
   tool calls. Observability for AI calls.
2. **Evals**: keep a dataset of example inputs with expected or
   good outputs, run an agent against all of them, and score the results
   (exact match, JSON schema, embedding similarity, or LLM-as-judge).
   Unit tests for non-deterministic AI.
3. **Regression detection / A/B**: compare prompt or model version A
   against B on the same dataset, catch quality regressions before they
   ship (CI gate).

The differentiator versus Langfuse, Braintrust, Laminar, Phoenix, and
Helicone: it runs natively inside your own Convex deployment, and because
Convex is reactive, the eval dashboard updates live (subscriptions)
instead of polling. Self-hostable, Apache-2.0.

## Why it exists

Portfolio and lead-generation repository to support repositioning as an
"Agentic AI Solution Architect." It is a proof of competence, not a
product with a growth target. It succeeds the moment it is built, clean,
and demonstrable. See also the sibling component `convex-mcp-gateway`,
which is the proven reference for structure and conventions.

## Verified facts (2026-05-20)

- npm name `convex-evalbench` is free (registry returns 404). No scope is
  used, matching `convex-mcp-gateway`.
- `@convex-dev/agent` is at v0.6.1 and exposes both ingestion hooks the
  adapter relies on: `usageHandler` (documented) and
  `rawRequestResponseHandler` (present in source, undocumented). Token
  usage is documented for billing only; there is no native eval, dataset,
  judge, or OpenTelemetry support.
- The gap is open: Convex issue get-convex/agent#11 (tracing forwarding to
  Datadog/Axiom) has been open ~13 months, and the OTel roadmap request
  has sat at "Requested" with the maintainers stating they could not get
  the OpenTelemetry integration working. Even if Convex ships tracing,
  evals plus judges plus regression plus A/B is a separate, larger surface
  that is not on their roadmap.

## Locked decisions

- **Single npm package**, unscoped name `convex-evalbench`. No monorepo,
  no `@scope`. The original strategy doc proposed a Turborepo with five
  packages; that is rejected in favor of the single-package layout that
  got `convex-mcp-gateway` accepted into the Convex Components directory.
- **License: Apache-2.0** (consistent with `convex-mcp-gateway`).
- **No dedicated domain, no standalone marketing website.** It is a
  component on the project list, not a product.
- **GitHub** `tfohlmeister/convex-evalbench`, private initially. Public
  plus Components-directory listing later.
- **Style mirrors `convex-mcp-gateway`** end to end: `src/component`
  plus `src/client` split, `src/shared.ts`, `src/test.ts` convex-test
  helper, `example/convex` as the demo and test bed, `tsc` build with an
  exports map, GitHub Actions, `pnpm check`. Design philosophy: the host
  owns auth and HTTP routes (Convex does not propagate `ctx.auth` into
  component code), writes are best-effort, registration is type-safe.
- The agent adapter is **one of several ingestion sources**, not the
  product. The eval engine (tables, runner, scorers, judges, queries)
  does not depend on `@convex-dev/agent`. This keeps the obsolescence and
  hook-breakage risk shallow.

## Repository conventions

- `pnpm check` runs codegen, build, typecheck, test, lint. Must be green
  before any commit or push.
- `pnpm local:start` downloads the pinned `convex-local-backend` binary
  and starts a local backend on ports 3312/3313 (no Docker, no Convex
  account). It writes `.env.local`, which the `convex` CLI then picks up.
  Codegen requires a configured deployment, so the local backend must be
  running when the schema or component functions change.
- `_generated` directories are committed. CI (`.github/workflows/test.yml`)
  runs `pnpm run build` (tsc) against the committed `_generated`, so it
  needs no backend.
- `.tools`, `.convex-local`, `.env.local`, `.claude`, `.remember`,
  `.playwright-cli` are git-ignored.

## Architecture sketch (to be finalized in OpenSpec)

### Data model (proposed, MVP = 5 tables)

All tables live in the component schema (`src/component/schema.ts`).

- `eval_traces`: one row per span. Fields: `runId?` (null for production
  live spans), `spanId`, `parentSpanId?`, `traceId`, `kind`
  (`llm | tool | agent_step | workflow_step | judge`), `agentName?`,
  `threadId?`, `userId?`, `model?`, `operationName`, `input?`, `output?`,
  `inputTokens?`, `outputTokens?`, `latencyMs?`, `costUsd?`, `status`,
  `errorType?`, `startedAt`, `endedAt?`. Indexed by
  `(traceId, startedAt)`, `(runId, startedAt)`, `(threadId, startedAt)`.
- `eval_datasets`: `name`, `version`, `parentVersionId?`, `itemCount`,
  `archived`.
- `eval_dataset_items`: `datasetId`, `input`, `expectedOutput?`,
  `expectedTools?`, `tags?`, `slice?`.
- `eval_runs`: `datasetId`, `targetVersion`, `targetEnv`, `triggeredBy`,
  `status`, `summaryScore?`, `completedCount`, `config`.
- `eval_results`: `runId`, `itemId`, `output`, `scores`, `judgesUsed?`,
  `passed`, `traceId?`, `latencyMs?`, `costUsd?`. Indexed by
  `(runId, itemId)` for idempotency.

Bandwidth note: spans can be 4 to 32 KB. Consider lazy storage of large
`input`/`output` in Convex File Storage (row holds a storage id), and an
aggregate metrics row per run so the summary view reads one row.

### Ingestion (one adapter pattern, several sources)

- MVP: convex-agent adapter `withEvalbench(agent)` wiring `usageHandler`
  plus `rawRequestResponseHandler` into component mutations. Content
  recording (raw input/output) opt-in via an env flag.
- Phase 2: OTLP HTTP receiver, Vercel AI SDK middleware.
- Batching via the Convex Workpool component to bound write rate.

### Eval runner

- An action enqueues each dataset item into a Workpool for bounded
  parallelism, invokes the target, scores it, writes an `eval_results`
  row idempotently.
- Triggers: `npx convex run`, a cron smoke test, a CI hook, a dashboard
  click. (No dedicated CLI binary in MVP.)

### Scorers and judges

- Built-ins: `exactMatch`, `jsonSchema` (ajv), `embeddingSimilarity`
  (cosine), `llmAsJudge` (recorded as a `kind: "judge"` span whose parent
  is the item result span).
- Multi-judge consensus (pass on majority).
- Custom scorers registered by the host via `defineScorer`.

### Reactive queries (the wow)

- `spansByTraceId(traceId)` powers a live span tree that fills in while a
  run executes. Demonstrated in `example/`; a fuller dashboard is a later
  companion app, not part of the component package.

### Client API surface (mirror `McpGateway`)

- `class Evalbench(components.evalbench)` with methods added per phase:
  span recording helpers, dataset CRUD, `startRun`, scorer registration,
  result and trace queries, retention/prune helpers driven by host crons.
- `withEvalbench(agent)` adapter and `defineScorer` as standalone exports.

## Scope: MVP versus deferred

In the v0.1.0 MVP:

- convex-agent adapter ingestion
- trace/span tables plus reactive queries (live span tree)
- datasets and dataset items
- eval runner with Workpool parallelism
- scorers: exactMatch, jsonSchema, embeddingSimilarity, llmAsJudge
- `Evalbench` client class and `convex-evalbench/test` helper
- `example/convex` demo app with a small live span-tree UI

Deferred (roadmap / "Phase 2 product"):

- standalone TanStack dashboard app (separate companion repo)
- `npx evalbench` CLI
- CI-gate GitHub Action plus PR comment
- A/B routing plus Bayesian significance cron
- OTLP HTTP receiver and AI SDK middleware
- drift-detection cron, cost-per-outcome heatmap, dataset version diff UI

## Phase plan

- **Phase 0 (done): Foundation.** Repo skeleton, build/lint/test
  pipeline green, empty component, example app, CI, local backend script.
- **Phase 1: Tracing core.** `eval_traces` schema, ingestion mutations,
  `withEvalbench` adapter, `spansByTraceId` plus recent-traces queries,
  example agent wrapped. Verify: spans land and render as a tree, live in
  the example.
- **Phase 2: Datasets and runner.** Dataset tables, dataset CRUD,
  `startRun` action with Workpool parallelism, `exactMatch` and
  `jsonSchema` scorers, idempotent results. Verify: a dataset runs and
  results are scored with a summary.
- **Phase 3: Judges and semantic scorers.** `embeddingSimilarity`,
  `llmAsJudge` (traced as a judge span), multi-judge consensus,
  `defineScorer`. Verify: judge verdicts are traced and scored.
- **Phase 4: Wow and docs.** Live span-tree UI in the example, run-compare
  view, architecture docs plus diagrams, README with badges, getting
  started. Release v0.1.0 (private).
- **Phase 5+: Phase 2 product.** Items from the deferred list as demand
  and time allow.

## Open questions for OpenSpec planning

- Span storage: inline `input`/`output` versus File Storage from day one,
  and where the opt-in content-recording flag lives.
- Workpool: take the dependency in Phase 1 (batching ingestion) or only in
  Phase 2 (runner parallelism)?
- Cross-deployment runs (invoking a production deployment's action over
  HTTP with a signed token): MVP or Phase 2?
- Multi-tenancy and dataset ownership model (`createdBy`, optional
  `teamId`) for the eventual public/hosted story.
- How much of the dashboard ships inside `example/` versus a separate
  `convex-evalbench-demo` companion repo (mirroring the mcp-gateway demo).

## Reference

- `convex-mcp-gateway` (sibling repo, already in the Convex Components
  directory) is the canonical style and structure reference. When in
  doubt about layout, build scripts, exports map, test helper, or CI,
  copy its approach.
- `@convex-dev/agent` hooks: `usageHandler`, `rawRequestResponseHandler`.
- Convex Workpool component for bounded parallelism and batching.

### Internal references (remove before making the repo public)

- Strategy and full research live in the `fohlmeister` repo under
  `docs/oss-leuchtturm/` (`README.md` strategy overview,
  `convex-evalbench.md` full plan).
- Kanban tracking task #224; research reports and architecture discussion
  in task #203.
