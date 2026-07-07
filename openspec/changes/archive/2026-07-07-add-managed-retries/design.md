## Context

The worker loop is `claimNext -> invoke target -> score -> finalize`,
repeated until no `pending` result remains. `claimNext` is a
serializable mutation that flips one row `pending -> running`, bumps its
`attempts`, and stamps `claimedAt`; `finalize` writes the terminal state
and bumps the run counters, no-op once a result is terminal
(at-most-once). `redriveRun` already re-pends rows stuck in `running`
past a cutoff while below `maxAttempts`, and finalizes them as
`max_attempts` errors at the cap. Managed retries slot into the worker's
`catch` block, which today finalizes every target throw as an `error`.

## Goals / Non-Goals

Goals:

- Retry a throwing target automatically, up to `maxAttempts`, when the
  failure is marked retryable, with exponential backoff between tries.
- Reuse the existing `attempts` counter and the claim/finalize seam; no
  new result state, no change to queries or result shape.
- Keep the terminal outcome unchanged for non-retryable throws (finalize
  immediately) and for exhausted retries (finalize `error`).

Non-Goals:

- No global rate limiting or token-bucket across items; backoff is
  per-item only.
- No blanket retry of every throw. A failure retries only when the
  target opts in, so deterministic bugs are not retried needlessly.
- No change to `redriveRun`; crashed-worker recovery stays host-invoked.

## Decisions

### Retryable signal: a marked `ConvexError`, detected by shape

The target is a host action the worker invokes with `ctx.runAction`. A
plain `Error` loses everything but its message across that boundary,
while a `ConvexError`'s `data` payload is preserved. So a host marks a
failure retryable by throwing `retryableError(message)`, which builds
`new ConvexError({ [RETRYABLE_ERROR_FLAG]: true, message })`. The worker
detects it with `isRetryableError(err)`, which checks
`err.data?.[RETRYABLE_ERROR_FLAG] === true` by **shape** (not
`instanceof`), so detection survives the component call boundary and any
class-identity mismatch. The flag key is namespaced
(`evalbenchRetryable`) to avoid colliding with a host's own error data.
Both helpers live in `src/shared.ts` (imported by client and component
alike) and `retryableError` is re-exported from `convex-evalbench` for
hosts to throw inside their targets.

### Backoff via a scheduled re-pend, item left `running` in between

On a retryable throw below the cap, the worker does not re-pend inline
(which would let the same loop re-claim it immediately and busy-spin a
rate-limited provider). Instead it schedules `retryItem` after
`retryBackoffMs(attempts)` and continues to the next item, leaving the
failed row in `running`. When the timer fires, `retryItem` flips that
row back to `pending` and schedules a worker, so the item is re-claimed
(bumping `attempts` again) and the target re-invoked. Leaving it
`running` during the short backoff also drains the worker pool cleanly:
if this was the last item, the current worker exits and the scheduled
`retryItem` revives the run.

`retryBackoffMs(attempts)` is `min(BASE * 2^(attempts-1), MAX)` with
`BASE = 1s`, `MAX = 30s`: 1s, 2s, 4s, 8s, 16s, 30s, ... Deterministic
(no jitter) to keep it simple; the cap stays far under the 10-minute
`redriveRun` cutoff, so a retrying item is never mistaken for wedged.

### `claimNext` returns `attempts`; the cap decides retry vs finalize

The worker needs the post-claim `attempts` to compare against
`maxAttempts`, so `claimNext` now returns it (the value it just wrote,
`attempts + 1`). In the `catch`: if the error is retryable **and**
`attempts < maxAttempts`, schedule the backoff re-pend; otherwise
finalize as `error` with the target's error name, exactly as today.
Since `claimNext` bumps `attempts` on every claim, "attempts 1 and 2
retry, attempt 3 finalizes" falls out for the default cap of 3.

### `retryItem` is idempotent and run-aware

`retryItem` re-pends only when the row is still `running` and the run is
still `running`; otherwise it is a no-op (a redrive or a terminal run
may have moved on). This keeps at-most-once intact: the row is either
retried once per scheduled timer or already terminal.

## Risks / Trade-offs

- A retryable target that always fails burns `maxAttempts` tries with
  backoff before recording `error`, so a persistently-broken retryable
  target completes its run slower than a non-retryable one. Bounded by
  the cap and acceptable; hosts control it via `maxAttempts` and by only
  marking genuinely transient failures retryable.
- The retryable signal depends on the host throwing the marked error;
  targets that throw plain errors get today's behavior (no retry). This
  is intended: retries are opt-in per failure.

## Migration Plan

None. `attempts` and `maxAttempts` already exist on results and config;
existing runs and callers are unaffected. Targets that never throw
`retryableError` behave exactly as before.
