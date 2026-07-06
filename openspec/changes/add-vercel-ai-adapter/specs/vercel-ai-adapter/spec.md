## ADDED Requirements

### Requirement: Wrap a Vercel AI SDK model

The system SHALL provide an adapter that builds a Vercel AI SDK
`LanguageModelV2Middleware` which records a span for each model call made
through the wrapped model, forwarding into the tracing ingestion API. The
tracing core MUST NOT depend on this adapter, and `ai` MUST be an
optional/peer dependency used only by the adapter; the adapter MUST NOT
import a value from `ai` (it describes the AI SDK types structurally) so
the package builds and tests without `ai` installed.

#### Scenario: Wrapped model records spans

- **WHEN** a host wraps an AI SDK model with the adapter's middleware and
  makes a `generateText` call through it
- **THEN** an `llm` span is recorded for that call via the tracing
  ingestion API

#### Scenario: Core builds without the AI SDK

- **WHEN** the package is built and tested without `ai` installed
- **THEN** the build and the tracing-core tests succeed, because the
  adapter carries no value import of `ai`

### Requirement: Map AI SDK call data to span fields

The adapter SHALL map the AI SDK model and result onto span fields:
`model.modelId` and `model.provider` to the span's model/provider, the
result usage to the span's token counts, and provider metadata to the
span's `metadata`. The adapter SHALL measure the call and set `latencyMs`
from the call's start to its completion.

#### Scenario: Usage and latency appear on the span

- **WHEN** a wrapped model completes a call reporting token usage
- **THEN** the recorded span carries the model, provider, token counts,
  and a `latencyMs` measured across the call

### Requirement: Trace grouping and correlation

Spans recorded by one middleware instance SHALL share a `traceId`. The
adapter SHALL accept caller-supplied `traceId`, `parentSpanId`, and
`runId` so a caller can correlate spans with an existing trace or an eval
run; when supplied, the recorded span SHALL carry them.

#### Scenario: Calls through one instance share a trace

- **WHEN** a wrapped model makes several model calls through one
  middleware instance
- **THEN** the resulting spans share a `traceId`

#### Scenario: Caller correlation is honored

- **WHEN** the middleware is built with a `traceId` and a `runId`
- **THEN** spans it records carry that `traceId` and `runId`

### Requirement: Adapter content recording is opt-in

The adapter SHALL record raw request/response content as span content
only when content recording is enabled via its options (default
disabled), delegating inline-versus-File-Storage handling to the tracing
ingestion API.

#### Scenario: Content recording disabled by default

- **WHEN** a host wraps a model without enabling content recording
- **THEN** spans are recorded with metadata only and no raw request or
  response content is persisted

#### Scenario: Content recorded when enabled

- **WHEN** content recording is enabled and the wrapped model makes a
  call
- **THEN** the request prompt and the response text are recorded as the
  span's content through the ingestion API

### Requirement: Streaming calls are recorded

The adapter SHALL record a span for a streaming call, capturing the final
usage and status from the stream's completion, and recording the span
when the stream finishes.

#### Scenario: Streamed call records one span at completion

- **WHEN** a wrapped model is used for a streaming call that runs to
  completion
- **THEN** exactly one `llm` span is recorded when the stream finishes,
  carrying the usage reported at stream completion

### Requirement: Recording never breaks the wrapped call

Span recording MUST be best-effort: a recording failure SHALL NOT throw
back into the caller. When the wrapped model call itself errors, the
adapter SHALL record a span with error status and error type and MUST
rethrow the original error unchanged.

#### Scenario: Recording failure is swallowed

- **WHEN** span recording fails internally during a wrapped call
- **THEN** the call resolves with its normal result and the failure does
  not surface to the caller

#### Scenario: Model error is recorded and rethrown

- **WHEN** the underlying model call throws
- **THEN** an error-status span is recorded and the original error is
  rethrown to the caller unchanged
