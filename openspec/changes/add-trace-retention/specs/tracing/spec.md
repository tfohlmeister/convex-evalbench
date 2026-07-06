## ADDED Requirements

### Requirement: Prune trace spans by age

The system SHALL provide a host-invoked prune operation that deletes
trace spans whose start time is older than a caller-chosen cutoff
(defaulting to a fixed retention window), in bounded batches, and SHALL
delete each pruned span's recorded File Storage content alongside the
span row so no stored content is orphaned. The operation SHALL report
whether more prunable spans may remain, so the caller can drive it to
completion.

#### Scenario: Spans older than the cutoff are deleted

- **WHEN** a host prunes with a cutoff and some spans started before it
- **THEN** those spans are deleted and spans newer than the cutoff
  remain

#### Scenario: Pruned content is not orphaned

- **WHEN** a pruned span had its content stored in File Storage
- **THEN** that File Storage content is deleted together with the span
  row

#### Scenario: Pruning drains in bounded batches

- **WHEN** more prunable spans remain than one batch deletes
- **THEN** the operation reports that more may remain, and repeating it
  eventually deletes all spans older than the cutoff
