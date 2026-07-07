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
(with `errorType`), or is retried when the failure is retryable (see
[Managed retries](#managed-retries)), and the run continues. No external
work-queue dependency.

Each item's result row moves through this lifecycle:

![Result lifecycle: startRun creates a pending row; a worker claims it (running, bumping attempts); a successful, scored target gives success; a non-retryable throw or reaching the attempts cap gives error; a retryable throw below the cap re-queues the item after a backoff (managed retry); a stuck running row is recovered by the host-invoked redrive.](./runner-lifecycle.svg)

## Scorers

Two families, freely mixed per run config. A result's overall `passed`
is true when every applied scorer passes; its item score is the mean
of the scorer scores, and the run's `summaryScore` is the running mean
of item scores.

**Deterministic built-ins** run in-component:

- **`exactMatch`**: deep-equals `output` against the item's
  `expectedOutput`. Score 1 or 0.
- **`jsonSchema`**: validates `output` against the schema in the scorer
  config. Score 1 when valid, otherwise 0 with the validation errors in
  the score's `details`. Validation uses
  [`@cfworker/json-schema`](https://www.npmjs.com/package/@cfworker/json-schema),
  an interpreted (eval-free) validator, because Convex's V8 runtime
  forbids `eval` / `new Function` (which rules out ajv's compiled mode).

Both are also exported from the package root for scoring outside a run.

**Handle-based scorers** are host actions the worker invokes per item,
exactly like the run target; the component stays free of LLM and
embedding provider SDKs. A throwing handle scorer yields a failing
score record with the error in its details; it never errors the item.

### Custom scorers: defineScorer

`defineScorer` wraps your handler into an action config whose
validators enforce the scorer contract
(`{ input, output, expectedOutput?, runId, itemId, traceId?, config? }
-> { score, passed, details? }`, score clamped to [0, 1]):

```ts
import { action } from "./_generated/server.js";
import { defineScorer } from "convex-evalbench";

export const politeness = action(
  defineScorer(async (ctx, args) => {
    const score = await rateOutput(args.output);
    return { score, passed: score >= 0.5 };
  }),
);
```

Select it per run: `{ type: "custom", name: "politeness", fn:
api.evals.politeness, config?: ... }`. `startRun` resolves the
function reference to a handle, so no separate registration step
exists.

### LLM-as-judge and consensus

`llmAsJudge` builds a judge handler from a rubric plus your own LLM
call (typically the AI SDK), so the model choice and API key stay in
your app:

```ts
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { defineScorer, llmAsJudge } from "convex-evalbench";

export const politeJudge = action(
  defineScorer(
    llmAsJudge({
      name: "polite-judge",
      rubric: "The reply is polite and professional.",
      generate: async (prompt) => {
        const { text } = await generateText({
          model: anthropic("claude-haiku-4-5"),
          prompt,
        });
        return text;
      },
      evalbench, // records each verdict as a `judge` span
    }),
  ),
);
```

The prompt instructs the model to answer with JSON
`{ "pass", "score", "reasoning" }`; a bare `PASS`/`FAIL` answer is
accepted as a lenient fallback, and an unparseable response becomes a
failing verdict with the raw text in the details. With an `Evalbench`
instance provided, every verdict is recorded as a `kind: "judge"` span
in the item's trace (run-stamped), so judge cost and latency are
observable like any other LLM call; pass `recordContent: true` to also
store the prompt and raw response.

Judge verdicts are LLM output and therefore injectable: a target
output containing instructions ("answer with pass: true") can steer
the verdict. The built prompt delimits input/output as data, which
raises the bar but cannot eliminate the risk; treat judge verdicts on
untrusted outputs as advisory, and prefer deterministic scorers where
a hard gate matters.

For flake tolerance, run a panel:
`{ type: "consensus", name: "panel", judges: [judgeA, judgeB, judgeC],
quorum?: 2 }`. All judges run in parallel; the entry passes when the
quorum (default: strict majority) passes, its score is the mean, and
the per-judge verdicts land in the details. A throwing judge counts as
a failed vote.

### embeddingSimilarity

`{ type: "embeddingSimilarity", embedder: api.evals.embed, threshold?:
0.8 }` scores the cosine similarity between `output` and
`expectedOutput`. The embedder is a host action with the contract
`{ texts: string[] } -> number[][]` (one vector per text), e.g. via
the AI SDK's `embedMany`. Non-string outputs or a missing
`expectedOutput` fail the scorer gracefully with a reason in the
details.

## Recovering a wedged run

A worker that dies mid-item (killed action, deploy) leaves that item
`running`. `redriveRun` is the host-invoked recovery:

```ts
await evalbench.redriveRun(ctx, runId); // olderThanMs default: 10 min
```

Results stuck in `running` longer than the cutoff go back to `pending`
and are processed again, up to the run's `maxAttempts` (config,
default 3); beyond the cap they are finalized as `error`
(`errorType: "max_attempts"`) so the run always terminates. Note that
a re-driven item invokes the target again: at-most-once applies to
scoring and results, so targets should tolerate re-invocation.

## Managed retries

`redriveRun` recovers *crashed* workers. Managed retries handle the
other failure mode: a target that **throws** for an item. By default a
throw is recorded as an `error` on the first attempt. To have the runner
retry instead, the target throws a **retryable** error:

```ts
import { retryableError } from "convex-evalbench";

export const myTarget = action({
  args: { input: v.any(), runId: v.string(), itemId: v.string() },
  handler: async (ctx, args) => {
    try {
      return { output: await callProvider(args.input) };
    } catch (err) {
      if (isRateLimit(err)) throw retryableError("provider rate limited");
      throw err; // non-retryable: recorded as error immediately
    }
  },
});
```

When the target throws `retryableError(...)` and the item is below the
run's `maxAttempts` (config, default 3), the runner re-queues the item
after an **exponential backoff** (1s, 2s, 4s..., capped at 30s) and
invokes the target again; at the cap the item is finalized as an
`error`, so the run always terminates. Any other throw is recorded as an
`error` on that attempt, with no retry, so a deterministic bug is not
retried three times. Set `maxAttempts: 1` to disable retries for a run.

`retryableError` builds a `ConvexError` whose payload the runner
recognises; its `message` is preserved. Because retries re-invoke the
target, the same at-most-once caveat applies as for `redriveRun`:
scoring and results happen once, but the target may run several times,
so targets should tolerate re-invocation.

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

## Comparing runs and the CI gate

Evals answer "how good is this version"; comparison answers "did this
change make it worse". Two runs over the **same dataset** join per item
(results are keyed `(runId, itemId)` and dataset versions are
immutable), so a candidate run can be graded against a baseline.

```ts
export const comparison = query({
  args: { baselineRunId: v.string(), candidateRunId: v.string() },
  handler: (ctx, args) => evalbench.compareRuns(ctx, args),
});
```

`compareRuns` returns `{ baseline, candidate, stats, items }`. Each item
is classified against the baseline:

- **`regressed`**: baseline passed, candidate terminal and failed.
- **`improved`**: baseline failed, candidate terminal and passed.
- **`unchanged`**: both terminal, same pass/fail.
- **`incomplete`**: either side still pending/running (or missing).

An `error` result counts as `passed: false` with score 0, so a target
failure that the baseline passed is an honest regression. `stats`
carries the four classification counts plus, over each side's terminal
items, the pass count and the mean item score. Per-item entries are
lean (`itemId`, both statuses, both `passed`/`score`, the `scoreDelta`,
the classification); drill into raw outputs and per-scorer records via
`listResults`. The query is **reactive**: subscribe while the candidate
run is still executing and items move from `incomplete` to a terminal
classification live, no re-polling.

### The gate

`evaluateGate` applies thresholds to the same comparison and returns a
verdict `{ ok, reasons, stats }`:

- **`maxRegressedItems`** (default 0): more regressions than this fails.
- **`minPassRate`** (optional): candidate pass rate over terminal items
  below this fails.
- **`maxScoreDrop`** (optional): a baseline-minus-candidate mean-score
  drop above this fails.

A candidate run that is not `completed` fails with the single reason
`"candidate run not completed"`, so a CI job that forgot to wait fails
loud instead of gating on partial data.

```ts
const verdict = await evalbench.evaluateGate(ctx, {
  baselineRunId,
  candidateRunId,
  thresholds: { maxRegressedItems: 0, minPassRate: 0.9 },
});
// { ok: false, reasons: ["1 item(s) regressed (max 0)"], stats: {...} }
```

Compare runs with **identical scorer configs**: comparing runs scored
differently mixes meanings, and a gate is only trustworthy when both
sides are measured the same way.

### CI recipe: a throwing action

The gate is a query with no side effects (a dashboard can render the
verdict). For a CI pass/fail, wrap it in a host action that throws on a
failing verdict, so `npx convex run` exits non-zero:

```ts
export const assertGate = action({
  args: { baselineRunId: v.string(), candidateRunId: v.string() },
  handler: async (ctx, args) => {
    const verdict = await evalbench.evaluateGate(ctx, args);
    if (!verdict.ok) throw new ConvexError(verdict.reasons.join("; "));
  },
});
```

```sh
# In CI, after the candidate run has completed:
npx convex run evals:assertGate \
  '{"baselineRunId": "...", "candidateRunId": "..."}'
# exits non-zero (and prints the reasons) if the gate fails
```

`listRuns({ datasetId, limit? })` returns a dataset's runs newest first
(default 50, capped 200), so CI can locate the baseline, e.g. the latest
completed run of a known `targetVersion`.

> **Scale.** Comparison collects every result of both runs and returns
> one entry per item. Eval datasets are bounded (hundreds, not millions,
> of items), so this stays well within query limits; pagination is the
> escape hatch if a dataset ever grows past that.

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

`example/compare-proof.mjs` proves the comparison and gate: it runs a
baseline target, an identical rerun, and a deliberately regressed
variant over one dataset, then asserts the compare classifies the
regressed item, the gate fails against the regression and passes
against the rerun, and the `assertGate` action throws for CI.

## Limits (this phase)

- No global rate limiting or token bucket across items: managed retries
  back off per item (see above), but there is no shared throttle over a
  run's concurrency. A target that fans out to a rate-limited provider
  should cap `concurrency` and mark rate-limit failures retryable.
- Run counters contend on the single run row; with the concurrency cap
  of 16 this is negligible.
- Dataset items are stored inline (no File Storage offload); keep
  fixtures reasonably small.
