## ADDED Requirements

### Requirement: Host-registered scorers via defineScorer

The system SHALL let a host register custom scorers as host actions
built with `defineScorer`, which enforces the scorer contract: the
action receives `{ input, output, expectedOutput?, runId, itemId,
traceId?, config? }` and returns `{ score, passed, details? }` with
the score in the range [0, 1].

#### Scenario: A custom scorer scores a run item

- **WHEN** a run config selects a custom scorer and the run executes
- **THEN** the scorer action is invoked once per item with the item's
  input, the target's output, and the run/item/trace identifiers, and
  its verdict is recorded as a score record on the item's result

#### Scenario: The scorer contract is shape-enforced

- **WHEN** a host builds a scorer with `defineScorer`
- **THEN** the resulting action validates its arguments and return
  value against the scorer contract, so a shape-incompatible scorer
  fails at the action boundary rather than corrupting results

### Requirement: Scorer references resolve to handles at startRun

The client SHALL accept Convex function references for handle-based
scorers in the run config and resolve them to function handles before
the run is created, so the stored run config is self-contained.

#### Scenario: A function reference becomes a stored handle

- **WHEN** a host passes a custom scorer's function reference to
  `startRun`
- **THEN** the run is created with a resolved function handle in its
  config and the worker invokes the scorer through that handle

### Requirement: A failing custom scorer does not fail the item

If a handle-based scorer throws, the runner SHALL record a failing
score record for that scorer (with the error in the score details) and
keep the item's result, including the output and all other scorers'
records.

#### Scenario: One throwing scorer keeps the result intact

- **WHEN** a run config selects two scorers and one of them throws for
  an item
- **THEN** the item's result is a success result containing the
  target's output, a failing score record for the throwing scorer with
  error details, and the other scorer's normal record

### Requirement: embeddingSimilarity scorer

The system SHALL provide an `embeddingSimilarity` scorer that obtains
embeddings for the target output and the item's expected output from a
host-provided embedder action (`{ texts: string[] } -> number[][]`),
scores their cosine similarity, and passes when the similarity meets
the configured threshold (default 0.8).

#### Scenario: Similar outputs pass the threshold

- **WHEN** the embedder returns near-identical vectors for output and
  expected output
- **THEN** the `embeddingSimilarity` score record carries a similarity
  at or above the threshold and is marked passing

#### Scenario: Dissimilar outputs fail the threshold

- **WHEN** the embedder returns clearly different vectors for output
  and expected output
- **THEN** the score record carries a similarity below the threshold
  and is marked failing

#### Scenario: Non-string output fails gracefully

- **WHEN** the target output or the expected output is not a string
- **THEN** the scorer records a failing score with a reason in the
  details instead of throwing
