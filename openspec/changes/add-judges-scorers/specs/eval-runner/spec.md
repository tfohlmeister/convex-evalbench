## MODIFIED Requirements

### Requirement: Score results with built-in deterministic scorers

The runner SHALL score each item's output with the scorers selected in
the run config, recording per-scorer score and pass plus an overall
pass on the result. Deterministic built-ins (`exactMatch`,
`jsonSchema`) run in-component; handle-based scorers (custom scorers,
`embeddingSimilarity`, judges) are invoked as host actions from the
worker, and all score records merge into the one result.

#### Scenario: exactMatch passes on an equal output

- **WHEN** an item's target output equals the item's `expectedOutput` and
  `exactMatch` is selected
- **THEN** the result records the `exactMatch` score as passing and the
  overall result as passed

#### Scenario: exactMatch fails on a differing output

- **WHEN** an item's target output differs from the item's `expectedOutput`
  and `exactMatch` is selected
- **THEN** the result records the `exactMatch` score as failing and the
  overall result as not passed

#### Scenario: jsonSchema passes on a valid output

- **WHEN** an item's target output satisfies the schema configured for the
  `jsonSchema` scorer
- **THEN** the result records the `jsonSchema` score as passing

#### Scenario: jsonSchema fails on an invalid output

- **WHEN** an item's target output violates the configured schema
- **THEN** the result records the `jsonSchema` score as failing and includes
  the validation errors in the score details

#### Scenario: Deterministic and handle-based scorers merge on one result

- **WHEN** a run config selects a deterministic scorer and a
  handle-based scorer for the same run
- **THEN** each item's result carries one score record per selected
  scorer and the overall pass requires every record to pass

## ADDED Requirements

### Requirement: Re-drive stuck results

The system SHALL provide a host-invoked re-drive operation for a run:
results stuck in `running` longer than a cutoff (default 10 minutes)
and below the attempts cap (default 3) return to `pending` and are
processed again; results at the attempts cap are finalized as errors.
Re-driving SHALL schedule a worker when it re-pends any result and
SHALL never touch terminal results.

#### Scenario: A stuck item is re-driven to completion

- **WHEN** a result has been `running` longer than the cutoff with
  attempts below the cap and the host invokes the re-drive
- **THEN** the result returns to `pending`, a worker is scheduled, and
  the item is processed and finalized normally

#### Scenario: The attempts cap converts a stuck item into an error

- **WHEN** a result stuck in `running` has reached the attempts cap
  and the host invokes the re-drive
- **THEN** the result is finalized as an error with a max-attempts
  error type and the run counters advance accordingly

#### Scenario: Re-drive leaves fresh and terminal results alone

- **WHEN** the host invokes the re-drive on a run with recently
  claimed `running` results and terminal results
- **THEN** neither the recently claimed nor the terminal results are
  modified
