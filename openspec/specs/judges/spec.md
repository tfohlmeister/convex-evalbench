# judges Specification

## Purpose

Provide LLM-as-judge scorers. `llmAsJudge` turns a rubric plus a host-supplied
`generate` function into a scorer whose parsed JSON verdict (pass, score,
reasoning) scores an item, failing safely on unparseable responses. Verdicts
are recorded as judge spans, and multiple judges can be combined into a
consensus.

## Requirements
### Requirement: llmAsJudge builds a judge scorer

The system SHALL provide an `llmAsJudge` builder that produces a
scorer handler from a rubric and a host-supplied `generate` function
(the host's LLM call). The judge prompt SHALL instruct the model to
answer with JSON `{ "pass": boolean, "score": number, "reasoning":
string }`, and the parsed verdict becomes the scorer's verdict.

#### Scenario: A judge verdict scores the item

- **WHEN** a run config selects a judge scorer built with `llmAsJudge`
  and the model returns a valid JSON verdict
- **THEN** the item's score record carries the model's score and pass
  verdict, with the reasoning in the details

#### Scenario: An unparseable verdict fails safely

- **WHEN** the model's response cannot be parsed into the verdict
  contract
- **THEN** the judge's score record is failing with the raw response
  and a parse error in the details, and the item's result is otherwise
  intact

### Requirement: Judge verdicts are traced as judge spans

The judge SHALL record each verdict as a `kind: "judge"` span when an
`Evalbench` instance is provided, stamped with the run id, attached to
the item's trace when the target returned a `traceId` and to a fresh
trace otherwise.

#### Scenario: A judge span lands in the item's trace

- **WHEN** a judge scores an item whose target returned a `traceId`
- **THEN** a `judge` span with that `traceId` and the run's id is
  recorded, carrying the judge's name as the operation name

### Requirement: Multi-judge consensus

The system SHALL support a consensus scorer entry listing several
judge handles: all judges are invoked for the item, the entry passes
when the number of passing verdicts reaches the quorum (default:
strict majority), its score is the mean of the judge scores, and the
per-judge verdicts are recorded in the details.

#### Scenario: Majority pass wins

- **WHEN** two of three judges pass an item under a default-quorum
  consensus entry
- **THEN** the consensus score record is marked passing with the mean
  score and three per-judge verdicts in the details

#### Scenario: A throwing judge counts as a failed vote

- **WHEN** one judge of a panel throws while the others pass with a
  quorum still reached
- **THEN** the thrown judge is recorded as a failed vote in the
  details and the consensus verdict is still passing

