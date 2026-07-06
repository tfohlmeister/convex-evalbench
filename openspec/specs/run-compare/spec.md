# run-compare Specification

## Purpose

Compare a baseline run and a candidate run over the same dataset, classifying
each item (regressed, improved, unchanged, incomplete) alongside aggregate
stats and score deltas, and filling in live as the candidate run finalizes.
A threshold-based gate turns a comparison into a pass/fail verdict for CI, and
a dataset's runs can be listed to pick the runs to compare.

## Requirements
### Requirement: Compare two runs over the same dataset

The system SHALL provide a compare query that takes a baseline run and
a candidate run referencing the same dataset and returns aggregate
stats (regressed, improved, unchanged, incomplete counts; pass counts
and mean scores over terminal items) plus one per-item entry with both
outcomes, the score delta, and a classification. Comparing runs of
different datasets SHALL be rejected.

#### Scenario: Per-item classification

- **WHEN** a baseline and a candidate run over the same dataset are
  compared and an item passed the baseline but failed the candidate
- **THEN** that item's entry is classified as regressed, and the
  aggregate regressed count includes it

#### Scenario: Runs of different datasets are rejected

- **WHEN** a compare is requested for two runs referencing different
  datasets
- **THEN** the compare is rejected and the caller is told the runs are
  not comparable

#### Scenario: Comparison fills in live

- **WHEN** a client subscribes to the comparison while the candidate
  run is still executing
- **THEN** items move from incomplete to a terminal classification as
  the candidate finalizes them, without the client re-polling

### Requirement: Threshold-based gate verdict

The system SHALL provide a gate evaluation that applies thresholds
(maximum regressed items, defaulting to 0; optional minimum candidate
pass rate; optional maximum mean-score drop) to a comparison and
returns a structured verdict with the failing reasons. A candidate run
that is not completed SHALL fail the gate with an explicit reason.

#### Scenario: A regression fails the default gate

- **WHEN** the gate is evaluated with default thresholds and one item
  regressed
- **THEN** the verdict is not ok and the reasons name the regressed
  item count

#### Scenario: An equal-or-better candidate passes

- **WHEN** the gate is evaluated with default thresholds and no item
  regressed
- **THEN** the verdict is ok with no reasons

#### Scenario: An incomplete candidate fails loud

- **WHEN** the gate is evaluated while the candidate run is not
  completed
- **THEN** the verdict is not ok and the reasons say the candidate run
  is not completed

### Requirement: List a dataset's runs

The system SHALL list the runs of a dataset, newest first, so a caller
can locate a baseline run.

#### Scenario: Runs are listed newest first

- **WHEN** a host lists the runs of a dataset that has multiple runs
- **THEN** it receives those runs ordered newest first, and no runs of
  any other dataset
