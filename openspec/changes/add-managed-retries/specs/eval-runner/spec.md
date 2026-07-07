## MODIFIED Requirements

### Requirement: A target failure is recorded, not fatal

The runner SHALL record a throwing target's item as an error and continue
executing the remaining items, unless the failure is retryable and the
item is below the attempts cap, in which case the runner retries the item
instead of recording an error (see the managed-retries requirement).

#### Scenario: One failing item does not abort the run

- **WHEN** the target throws a non-retryable error for one item in a run
- **THEN** that item's result is marked error with an error type, and the
  other items still complete and are scored

## ADDED Requirements

### Requirement: Managed retries for retryable target failures

The runner SHALL retry an item whose target throws a **retryable** failure
while the item is below the run's attempts cap (`maxAttempts`, default 3),
re-queuing the item after an exponential backoff and invoking the target
again on re-claim rather than finalizing it. A failure not marked
retryable SHALL finalize the item as an error on that attempt, and a
retryable failure at the attempts cap SHALL finalize the item as an error,
so every run terminates. Retrying SHALL reuse the existing per-item
attempts counter and SHALL not re-score or duplicate any already-terminal
result.

#### Scenario: A retryable failure below the cap is retried

- **WHEN** the target throws a retryable failure for an item whose
  attempts are below the cap
- **THEN** the item is re-queued (not finalized), a worker is scheduled
  after a backoff delay, and the target is invoked again for that item

#### Scenario: A retryable failure at the cap is finalized as an error

- **WHEN** the target throws a retryable failure for an item that has
  reached the attempts cap
- **THEN** the item's result is marked error and the run counters advance,
  the same as any recorded target failure

#### Scenario: A non-retryable failure is not retried

- **WHEN** the target throws a failure that is not marked retryable
- **THEN** the item is finalized as an error on that attempt, without a
  retry, regardless of the attempts cap

#### Scenario: Backoff grows across successive retries

- **WHEN** an item is retried more than once
- **THEN** each successive retry is scheduled after a longer backoff than
  the previous one, up to a fixed maximum
