## ADDED Requirements

### Requirement: A finalized result records its item score

The runner SHALL store each result's aggregate item score (the value
folded into the run's summary score) on the result row when the item
is finalized, so per-item comparisons need no recomputation.

#### Scenario: A finalized result carries its item score

- **WHEN** an item is finalized with scorer records
- **THEN** the result row stores the aggregate item score used for the
  run's summary score
