## 1. Shared helpers and constants

- [x] 1.1 Add `RETRY_BASE_DELAY_MS` (1s), `RETRY_MAX_DELAY_MS` (30s),
  and `RETRYABLE_ERROR_FLAG` to `src/shared.ts`.
- [x] 1.2 Add `retryableError(message)` (builds a flagged `ConvexError`),
  `isRetryableError(err)` (shape-based, boundary-safe), and
  `retryBackoffMs(attempts)` (`min(BASE * 2^(attempts-1), MAX)`).
- [x] 1.3 Update the `runConfigValidator` / `maxAttempts` doc comment to
  note it now caps managed retries as well as the stuck-row re-drive.

## 2. Runner worker retry path

- [x] 2.1 `claimNext` returns the post-claim `attempts` value.
- [x] 2.2 In `worker`'s catch: if `isRetryableError(err)` and
  `attempts < maxAttempts`, schedule `retryItem` after
  `retryBackoffMs(attempts)` and continue; else finalize as error.
- [x] 2.3 Add `retryItem` internal mutation: re-pend the row only when it
  is still `running` and the run is still `running`, then schedule a
  worker.

## 3. Client re-export

- [x] 3.1 Re-export `retryableError` from `src/client/index.ts` so hosts
  import it from `convex-evalbench`.

## 4. Tests

- [x] 4.1 `src/shared.test.ts` (or nearest): `retryableError` /
  `isRetryableError` round-trip, `isRetryableError` false for plain
  errors and foreign data, `retryBackoffMs` growth and cap.
- [x] 4.2 `src/component/runner.test.ts`: retryable throw below cap
  re-pends and schedules (no error result yet); retryable throw at cap
  finalizes error; non-retryable throw finalizes error immediately;
  `retryItem` no-op on terminal/non-running.

## 5. Docs

- [x] 5.1 `docs/evals.md`: add a "Managed retries" section (signal,
  backoff, cap, opt-out) and update the "Limits" bullet that claims no
  managed retries.
- [x] 5.2 `README.md`: move "Managed retries" from the roadmap "Next"
  list into the shipped paragraph.

## 6. Example and verification

- [x] 6.1 Use `retryableError` in an example target so the re-export
  typechecks against real host code.
- [x] 6.2 `pnpm check` green; run the retry path end-to-end against the
  local backend.
