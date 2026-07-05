## ADDED Requirements

### Requirement: Start an evaluation run

The system SHALL provide a `startRun` operation that takes a dataset, a
host-provided target function reference (the system under test), and a run
config (selected scorers, concurrency, optional pass threshold). It creates
a run pinned to that dataset and one pending result per dataset item.

#### Scenario: Run is created with one pending result per item

- **WHEN** a host starts a run over a dataset with N items
- **THEN** a run row is created referencing that dataset, and N result rows
  are created in a pending state, one per item

#### Scenario: Starting a run on a missing dataset is rejected

- **WHEN** a host starts a run for a dataset id that does not exist
- **THEN** no run is created and the caller is informed the dataset was not
  found

### Requirement: Bounded, idempotent execution

The runner SHALL execute items with bounded parallelism without depending
on an external work-queue component, and each item SHALL be processed at
most once even if execution is re-driven.

#### Scenario: Each item produces exactly one result

- **WHEN** a run over a dataset completes
- **THEN** there is exactly one result row per item, each in a terminal
  state (success or error)

#### Scenario: Re-driving a run does not re-score completed items

- **WHEN** run execution is re-driven after some items already have terminal
  results
- **THEN** already-completed items are not processed again and their results
  are unchanged

### Requirement: Score results with built-in deterministic scorers

The runner SHALL score each item's output with the scorers selected in the
run config, recording per-scorer score and pass plus an overall pass on the
result. Phase 2 provides two deterministic built-ins: `exactMatch` and
`jsonSchema`.

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

### Requirement: A target failure is recorded, not fatal

If the target function throws for an item, the runner SHALL record that
item's result as an error and continue executing the remaining items.

#### Scenario: One failing item does not abort the run

- **WHEN** the target throws for one item in a run
- **THEN** that item's result is marked error with an error type, and the
  other items still complete and are scored

### Requirement: Results link to traces

The runner SHALL stamp each run with a `runId` available to the target and
record the `traceId` the target returns on the corresponding result, so a
result can open its trace tree.

#### Scenario: A result records the target's trace id

- **WHEN** a target returns a `traceId` for an item
- **THEN** the corresponding result row stores that `traceId`

### Requirement: Reactive run summary and results

The system SHALL expose a run summary query that returns maintained counts
(total, completed, passed) and an aggregate score, updating live as items
finish, and a results query that returns one row per item for a run.

#### Scenario: Summary reflects progress as items complete

- **WHEN** a client subscribes to a run's summary while the run is executing
- **THEN** the completed and passed counts increase as items finish, without
  the client re-polling

#### Scenario: Results list returns one row per item

- **WHEN** a client lists the results of a run
- **THEN** it receives one result row per dataset item in the run
