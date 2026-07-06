## ADDED Requirements

### Requirement: Host-mounted OTLP trace receiver

The system SHALL provide an OTLP trace receiver as a handler factory the
host mounts as an HTTP route (via `httpAction`). The receiver SHALL
accept OTLP/JSON (`application/json`) trace export requests, map each
contained OpenTelemetry span into the tracing ingestion API, and return
an OTLP `ExportTraceServiceResponse`. The library MUST NOT own the route;
the host mounts it and supplies the `Evalbench` handle.

#### Scenario: OTLP/JSON export records spans

- **WHEN** an OTLP exporter posts an `application/json` trace export with
  spans to the mounted route
- **THEN** each span is recorded through the tracing ingestion API and
  the handler responds with an OTLP `ExportTraceServiceResponse`

### Requirement: Map OpenTelemetry spans with GenAI conventions

The receiver SHALL derive span identity (`traceId`, `spanId`,
`parentSpanId`), timing (`startedAt`, `endedAt`, `latencyMs` from the
OTel Unix-nano timestamps), and status from each OTel span, and SHALL map
OpenTelemetry GenAI semantic-convention attributes onto span fields:
`gen_ai.system` to provider, `gen_ai.request.model` (or response model)
to model, and `gen_ai.usage` token counts to the span's token counts. A
span with GenAI attributes SHALL be classified as an `llm` span.

#### Scenario: GenAI attributes populate span fields

- **WHEN** a received OTel span carries `gen_ai.system`,
  `gen_ai.request.model`, and `gen_ai.usage.*` attributes
- **THEN** the recorded span is an `llm` span with matching provider,
  model, and token counts, and its timing and status derive from the
  OTel span

### Requirement: Partial success on malformed spans

The receiver SHALL record each span independently and MUST NOT fail an
entire export because of individual bad spans. Spans that cannot be
mapped SHALL be skipped and counted, and the handler SHALL return `200`
with `partialSuccess.rejectedSpans` set when any span was skipped. A
request body that is not valid OTLP/JSON SHALL return `400`.

#### Scenario: One bad span does not drop the export

- **WHEN** an export contains several valid spans and one malformed span
- **THEN** the valid spans are recorded, the response reports one
  rejected span via `partialSuccess`, and the status is `200`

#### Scenario: Unparseable body is rejected

- **WHEN** the request body is not valid OTLP/JSON
- **THEN** the handler responds with `400`

### Requirement: Protobuf is not accepted

The receiver SHALL respond to an `application/x-protobuf` request with
`415 Unsupported Media Type` and a message directing the operator to use
the `http/json` protocol.

#### Scenario: Protobuf export is refused with guidance

- **WHEN** an exporter posts an `application/x-protobuf` trace export
- **THEN** the handler responds with `415` and a message to switch the
  exporter to `http/json`

### Requirement: Opt-in content and bounded, authorizable ingest

The receiver SHALL record raw prompt/completion content as span content
only when content recording is enabled (default disabled), reading it
from the GenAI content attributes. The receiver SHALL cap the number of
spans ingested per request, rejecting the overflow via `partialSuccess`.
The receiver SHALL support an optional authorization hook that, when it
denies a request, causes a `401` response before the body is processed.

#### Scenario: Content recorded only when enabled

- **WHEN** content recording is disabled and an export carries GenAI
  prompt/completion attributes
- **THEN** spans are recorded with metadata only and no raw content

#### Scenario: Unauthorized request is rejected

- **WHEN** an authorization hook is configured and denies a request
- **THEN** the handler responds with `401` and records no spans

#### Scenario: Oversized export is bounded

- **WHEN** an export carries more spans than the per-request cap
- **THEN** spans up to the cap are recorded and the remainder are
  reported as rejected via `partialSuccess`
