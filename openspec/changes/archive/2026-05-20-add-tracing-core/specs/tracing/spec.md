## ADDED Requirements

### Requirement: Span recording API

The system SHALL provide a source-agnostic ingestion API that records one
span per call, capturing identity (`traceId`, `spanId`, optional
`parentSpanId`), classification (`kind`, `operationName`, optional
`agentName`, `threadId`, `userId`, `model`, `provider`), metrics (optional
token counts, `latencyMs`, `costUsd`), and status/timing (`status`,
optional `errorType`, `startedAt`, optional `endedAt`). The API MUST NOT
import any specific LLM SDK.

#### Scenario: Record a metadata-only span

- **WHEN** a caller records a span with identity, classification, metrics,
  and timing but no raw content
- **THEN** an `eval_traces` row is created with those fields and no content
  is stored

#### Scenario: Span carries hierarchy

- **WHEN** a caller records a child span with a `parentSpanId` referring to
  an earlier span in the same `traceId`
- **THEN** the row stores `parentSpanId` so the trace can be assembled into
  a tree

### Requirement: Best-effort ingestion

Recording a span MUST be best-effort: a failure to record SHALL NOT throw
back into the caller's code path. Losing a span is the accepted failure
mode.

#### Scenario: Ingestion failure does not break the caller

- **WHEN** span recording fails internally (for example a transient write
  error)
- **THEN** the recording call resolves without throwing and the caller's
  own operation is unaffected

### Requirement: Single ingestion write seam

All span writes, from any ingestion source, SHALL funnel through one
internal write path so that batching or rate limiting can be added later
without changing callers or the public API. Phase 1 writes directly through
this seam and does not depend on an external Workpool component.

#### Scenario: All sources write through one path

- **WHEN** spans are recorded by the generic API or by an adapter
- **THEN** both reach the same internal write seam, and no external
  Workpool dependency is required to record a span

### Requirement: Opt-in content recording with File Storage

Raw span content (`input`/`output`) SHALL be recorded only when the source
enables content recording; metadata is always recorded. When recording is
enabled, content at or below a configured size threshold MUST be stored
inline on the row, and content above the threshold MUST be stored in the
component's File Storage with the row holding the storage id.

#### Scenario: Content recording disabled

- **WHEN** a span is recorded with content recording disabled
- **THEN** no `input`/`output` and no storage id are persisted, only
  metadata

#### Scenario: Small content stored inline

- **WHEN** content recording is enabled and the content is at or below the
  threshold
- **THEN** the content is stored inline in `input`/`output` and no File
  Storage object is created

#### Scenario: Large content offloaded to File Storage

- **WHEN** content recording is enabled and the content exceeds the
  threshold
- **THEN** the content is written to File Storage and the row stores
  `inputStorageId`/`outputStorageId` instead of the inline content

### Requirement: Reactive span-tree query

The system SHALL provide a reactive query that returns all spans for a
given `traceId` ordered by `startedAt`, returning metadata only (no
content). Subscribers MUST receive new spans as they are recorded so a
trace renders as a live, filling-in tree.

#### Scenario: Tree fills in live

- **WHEN** a client subscribes to the span-tree query for an in-flight
  trace and new spans are recorded
- **THEN** the subscription pushes the new spans without the client
  re-polling, and the returned spans contain no raw content

### Requirement: Recent-traces query

The system SHALL provide a query that lists recent traces (root spans,
those without a `parentSpanId`) newest first, limited to a caller-supplied
count.

#### Scenario: List most recent traces

- **WHEN** a client queries recent traces with a limit
- **THEN** it receives at most that many root spans ordered newest first

### Requirement: On-demand span content resolution

The system SHALL provide a query that resolves a span's recorded content on
demand, returning inline content directly and a signed URL for content held
in File Storage.

#### Scenario: Resolve stored content

- **WHEN** a client requests the content of a span whose content is in File
  Storage
- **THEN** it receives a signed URL it can fetch, not the blob inline in the
  tree query
