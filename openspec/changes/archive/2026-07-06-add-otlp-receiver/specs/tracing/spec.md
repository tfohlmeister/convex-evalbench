## ADDED Requirements

### Requirement: Batch metadata write through the single seam

The ingestion API SHALL provide a batch write that records many
metadata-only spans through the same internal write seam a single-span
record uses, in one transaction, so a high-volume source can ingest many
spans without one mutation per span. The batch write MUST reuse the
existing write seam (not a parallel path) and MUST NOT require content
recording; content-bearing spans continue through the per-span content
path.

#### Scenario: Many spans recorded in one write

- **WHEN** a source records a batch of metadata-only spans through the
  batch write
- **THEN** all of the spans are persisted through the single internal
  write seam in one transaction, with the same row shape as a single
  recorded span

#### Scenario: Batch write carries no content

- **WHEN** a batch of spans is recorded through the batch write
- **THEN** only span metadata is persisted and no inline or File-Storage
  content is written for those spans
