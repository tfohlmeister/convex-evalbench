## Why

The runner already carries a per-item `attempts` counter and a
`maxAttempts` cap, but today only the host-invoked `redriveRun`
consumes them, and only for workers that wedged (an item stuck in
`running` after a crashed action or deploy). A target that simply
throws for an item is finalized as an `error` on the very first
attempt, with no retry. Transient target failures (a rate-limited
provider, a flaky upstream, a momentary timeout) therefore turn into
permanent `error` results even though the next call would have
succeeded. The runner's own docs name the gap: "No managed retries
with backoff... the claim mutation remains the seam where automatic
retry/backoff would land."

## What Changes

- Add **managed retries** to the worker loop: when the target throws a
  **retryable** failure and the item is still below the run's
  `maxAttempts`, the runner re-queues the item after an **exponential
  backoff** (1s, 2s, 4s..., capped) instead of finalizing it. On
  re-claim the target is invoked again; once the item reaches the cap
  it is finalized as an `error`, so the run always terminates.
- Retries are **opt-in per failure**, signalled by the target. A host
  marks a failure retryable by throwing `retryableError("...")`, a
  helper re-exported from `convex-evalbench` that builds a `ConvexError`
  carrying a namespaced retry flag. Any other throw finalizes
  immediately, exactly as today, so a deterministic bug is not retried
  three times before it is recorded.
- `maxAttempts` (config, default 3) now governs **both** managed
  retries and the existing stuck-row re-drive; `maxAttempts: 1` opts a
  run out of retries entirely.

This modifies the existing `eval-runner` capability (the target-failure
requirement gains retryable handling, and a new managed-retries
requirement is added). It reuses the existing `attempts` field and the
`claimNext` -> worker -> `finalize` machinery; the only new component
function is a scheduled re-pend mutation. No public query or result
shape changes.

## Impact

- Affected specs: `eval-runner`.
- Affected code: `src/component/runner.ts` (worker retry branch,
  `claimNext` returns `attempts`, new `retryItem` mutation),
  `src/shared.ts` (backoff constants, `retryableError` /
  `isRetryableError` / `retryBackoffMs` helpers), `src/client/index.ts`
  (re-export `retryableError`). Docs: `docs/evals.md`, `README.md`
  roadmap. No migration: `attempts` and `maxAttempts` already exist.
