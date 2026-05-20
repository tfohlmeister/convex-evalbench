# convex-agent-adapter Specification

## Purpose

Provide `withEvalbench(agent, options)`, one optional ingestion source that
wraps a `@convex-dev/agent` agent and forwards its `usageHandler` and
`rawRequestResponseHandler` into the tracing ingestion API. The adapter
maps agent usage onto span fields, groups the calls of one agent operation
into a single trace, composes with any host-provided handlers instead of
replacing them, and records raw content only when opt-in is enabled. The
tracing core MUST NOT depend on this adapter.

## Requirements

### Requirement: Wrap a convex-agent agent

The system SHALL provide a `withEvalbench(agent, options)` adapter that
takes a `@convex-dev/agent` agent and returns an agent which records a span
for each LLM call it makes, forwarding into the tracing ingestion API. The
tracing core MUST NOT depend on this adapter, and `@convex-dev/agent` MUST
be an optional/peer dependency used only by the adapter.

#### Scenario: Wrapped agent records spans

- **WHEN** a host wraps an agent with `withEvalbench` and the agent makes an
  LLM call
- **THEN** a span is recorded for that call via the tracing ingestion API

### Requirement: Map agent usage to span fields

The adapter SHALL map the agent `usageHandler` arguments onto span fields:
`model` and `provider` to the span's model/provider, token usage to the
span's token counts, and `agentName`/`threadId`/`userId` to the matching
span fields.

#### Scenario: Usage data appears on the span

- **WHEN** the wrapped agent's `usageHandler` fires with model, provider,
  token usage, and thread/user identifiers
- **THEN** the recorded span carries those values

### Requirement: Group an agent operation into one trace

LLM (and tool) calls made within a single top-level agent operation SHALL
share a `traceId` and be linked by `parentSpanId` so the operation renders
as one trace tree.

#### Scenario: Multiple calls form one trace

- **WHEN** one agent operation makes several LLM or tool calls
- **THEN** the resulting spans share a `traceId` and link to a common root
  via `parentSpanId`

### Requirement: Compose with host-provided handlers

The adapter MUST NOT clobber handlers the host already configured. When the
host has set `usageHandler` or `rawRequestResponseHandler`, the adapter
SHALL invoke the original handler in addition to recording the span.

#### Scenario: Existing host handler still runs

- **WHEN** the host configured its own `usageHandler` before wrapping with
  `withEvalbench`
- **THEN** both the host handler and evalbench recording run for each call

### Requirement: Adapter content recording is opt-in

The adapter SHALL record raw request/response content as span content only
when content recording is enabled via its options (default disabled),
delegating inline-versus-File-Storage handling to the tracing ingestion
API.

#### Scenario: Content recording disabled by default

- **WHEN** a host wraps an agent without enabling content recording
- **THEN** spans are recorded with metadata only and no raw request or
  response content is persisted

#### Scenario: Content recorded when enabled

- **WHEN** content recording is enabled in the adapter options and the
  wrapped agent makes a call
- **THEN** the raw request and response are recorded as the span's content
  through the ingestion API
