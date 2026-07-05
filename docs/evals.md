# Evals: datasets, runs, and scorers

Repeatable evaluation for non-deterministic AI: keep a dataset of inputs
with expected outputs, run your system under test against every item,
and score the results into a pass rate you can compare across prompt or
model versions. This is the layer on top of [tracing](./tracing.md);
every run links its results back to the traces the target recorded.

## Datasets

A dataset is versioned: a dataset row is one immutable version, items
belong to exactly one version. `versionDataset` snapshots the current
items into a new version, so a run can pin version N while you keep
editing the tip.

```ts
const datasetId = await evalbench.createDataset(ctx, {
  name: "greetings",
  items: [
    { input: "hello", expectedOutput: "HELLO" },
    { input: "world", expectedOutput: "WORLD", tags: ["smoke"] },
  ],
});

await evalbench.addItems(ctx, {
  datasetId,
  items: [{ input: "convex", expectedOutput: "CONVEX" }],
});

const v2 = await evalbench.versionDataset(ctx, datasetId); // snapshot
await evalbench.archiveDataset(ctx, datasetId); // hide the old tip
```

`listDatasets` returns non-archived datasets (pass
`{ includeArchived: true }` for all); `listItems(datasetId)` returns a
version's items. An item carries `input`, optional `expectedOutput`,
plus optional `expectedTools`, `tags`, and `slice` for later filtering.

## The target contract

The system under test is a host **action** the runner invokes once per
item:

```ts
export const myTarget = action({
  args: { input: v.any(), runId: v.string(), itemId: v.string() },
  returns: v.object({ output: v.any(), traceId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    // Call your agent / LLM here. Stamp spans with args.runId (via
    // recordSpan or the agent adapter) so the run's traces correlate,
    // and return the traceId you want the result row to open.
    const output = await runMyAgent(args.input);
    return { output, traceId };
  },
});
```

An action (not a query or mutation) because a target typically calls an
LLM. A thin wrapper action around your existing entry point is enough.

## Starting a run

```ts
export const startEval = action({
  args: { datasetId: v.string() },
  handler: async (ctx, args) => {
    return await evalbench.startRun(ctx, {
      datasetId: args.datasetId,
      target: api.evals.myTarget,
      config: {
        scorers: [
          { type: "exactMatch" },
          { type: "jsonSchema", schema: { type: "string" } },
        ],
        concurrency: 4, // default 4, capped at 16
      },
      targetVersion: "prompt-v2", // optional label of what you're testing
    });
  },
});
```

`startRun` resolves `target` to a function handle, then a single
mutation creates the run with one `pending` result per item and
schedules `concurrency` worker actions, atomically: a run can never
exist without its workers having been scheduled. Each worker claims the
next pending item (a serializable mutation, so exactly one worker wins
a row), invokes the target, scores the output, and finalizes the
result; when a worker's time budget runs out it schedules a successor,
so large datasets are not bounded by a single action's time limit. The
claim transition makes every item process **at most once**, even if
execution is re-driven; a target that throws yields an `error` result
(with `errorType`) and the run continues. No external work-queue
dependency.

## Scorers

Built-in deterministic scorers, applied per the run config:

- **`exactMatch`**: deep-equals `output` against the item's
  `expectedOutput`. Score 1 or 0.
- **`jsonSchema`**: validates `output` against the schema in the scorer
  config. Score 1 when valid, otherwise 0 with the validation errors in
  the score's `details`. Validation uses
  [`@cfworker/json-schema`](https://www.npmjs.com/package/@cfworker/json-schema),
  an interpreted (eval-free) validator, because Convex's V8 runtime
  forbids `eval` / `new Function` (which rules out ajv's compiled mode).

A result's overall `passed` is true when every applied scorer passes.
Its item score is the mean of the scorer scores; the run's
`summaryScore` is the running mean of item scores. Both scorers are
also exported from the package root (`exactMatch`, `jsonSchema`) for
scoring outside a run. LLM-as-judge, `embeddingSimilarity`, and
host-defined scorers are planned (see the README roadmap).

## Reactive run views

```ts
export const runSummary = query({
  args: { runId: v.string() },
  handler: (ctx, args) => evalbench.runSummary(ctx, args.runId),
});

export const runResults = query({
  args: { runId: v.string() },
  handler: (ctx, args) => evalbench.listResults(ctx, args.runId),
});
```

`runSummary` returns the single run row with maintained counters
(`itemCount`, `completedCount`, `passedCount`) and the running
`summaryScore`; the counters are bumped in the same mutation that
writes each result, so a subscription shows live progress and can never
disagree with the results list. `listResults` returns one row per item
with `status`, `output`, per-scorer `scores`, `passed`, `latencyMs`,
and the `traceId` to open the item's trace tree via `spansByTrace`.

## Verifying locally

`example/eval-proof.mjs` drives the whole loop against a local backend:
seed a dataset, subscribe to `runSummary`, start a run, and assert the
counters stream in live until the run completes with every result
scored and trace-linked.

```sh
pnpm local:start          # terminal 1: local Convex backend
npx convex dev --once     # terminal 2: deploy the example
node example/eval-proof.mjs
```

## Limits (this phase)

- No managed retries or rate limiting: a failed item is recorded as
  `error` (with `attempts` tracked), and a worker that crashes mid-item
  (e.g. a killed action) leaves that item `running` until re-drive
  tooling lands. Retry/backoff and the stuck-row re-drive come with the
  judge phase; the claim mutation is the seam they land behind.
- Run counters contend on the single run row; with the concurrency cap
  of 16 this is negligible.
- Dataset items are stored inline (no File Storage offload); keep
  fixtures reasonably small.
