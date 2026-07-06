## Why

The tracing core is source-agnostic, but every shipped ingestion path is
a code-level wrapper (the agent adapter, and now the Vercel AI SDK
middleware). Teams that already instrument with OpenTelemetry, through
the OTel SDKs, OpenLLMetry / Traceloop, or a framework's built-in OTEL
export, have no way to point that telemetry at evalbench. A standards-
based receiver lets any OTLP-emitting app stream its LLM spans into the
host's Convex deployment with zero evalbench-specific code, just an
exporter endpoint.

## What Changes

- Add an **OTLP trace receiver**: a handler factory exported at
  `convex-evalbench/otlp` that a host mounts as an HTTP route in its
  `convex/http.ts`:

  ```ts
  import { httpRouter } from "convex/server";
  import { httpAction } from "./_generated/server";
  import { otlpTraceHandler } from "convex-evalbench/otlp";

  const http = httpRouter();
  http.route({
    path: "/v1/traces",
    method: "POST",
    handler: httpAction(otlpTraceHandler({ evalbench })),
  });
  export default http;
  ```

  An OTLP exporter (`OTEL_EXPORTER_OTLP_ENDPOINT=<deployment>/…`) then
  posts spans to it.
- The handler parses **OTLP/JSON** (`application/json`), maps each OTel
  span to a span through the tracing ingestion API, and returns an OTLP
  `ExportTraceServiceResponse`. Mapping uses OpenTelemetry **GenAI
  semantic conventions** (`gen_ai.system` -> provider,
  `gen_ai.request.model` -> model, `gen_ai.usage.*` -> tokens), classifies
  a span's `kind`, and derives `startedAt` / `endedAt` / `latencyMs` /
  `status` from the OTel span.
- **Protobuf is out of scope** for this change: `application/x-protobuf`
  is answered with `415 Unsupported Media Type` and a message to switch
  the exporter to `http/json`, because Convex's runtime has no native
  protobuf and bundling a decoder plus the OTLP schema is disproportionate
  here. It is a documented follow-up.
- **Partial success**: malformed spans are skipped and counted; the
  handler returns `200` with `partialSuccess.rejectedSpans` set (per the
  OTLP spec) rather than failing the whole export. A body that is not
  valid OTLP/JSON returns `400`.
- Content recording is **opt-in** (`recordContent`), reading
  `gen_ai` prompt/completion attributes into span content.
- The receiver writes efficiently via a new **batch metadata ingestion**
  seam on the component, so one export of many spans does not become one
  Convex mutation per span. This is the batching evolution the tracing
  capability already anticipated behind its single write seam.
- Optional **authorization**: the factory accepts an `authorize(request)`
  hook; when it returns false the handler answers `401`. An open ingest
  endpoint is a documented abuse vector, so the docs recommend a shared
  secret or bearer check here.

## Capabilities

### New Capabilities
- `otlp-receiver`: a host-mounted OTLP/JSON trace receiver that maps
  OpenTelemetry spans (with GenAI semantic conventions) into the tracing
  ingestion API, with partial-success reporting, opt-in content, an
  optional authorization hook, a bounded number of spans per request, and
  a `415` response for protobuf.

### Modified Capabilities
- `tracing`: the ingestion API SHALL provide a batch metadata write that
  records many metadata-only spans through the single write seam in one
  transaction, so high-volume sources (the receiver) ingest without one
  mutation per span.

## Impact

- Client: new `src/client/otlp.ts` (the handler factory and the OTel ->
  span mapping); new `./otlp` entry in the exports map.
- Component: a new batch metadata ingestion function in
  `src/component/ingestion.ts` behind the existing write seam; a
  corresponding `Evalbench.recordSpans` client method the receiver uses.
- Docs: an "OTLP receiver" section in `docs/tracing.md` (mounting the
  route, exporter config for `http/json`, the auth recommendation, the
  protobuf limitation, the semantic-convention mapping table); the README
  roadmap note moves from "Next" to shipped.
- No new runtime dependencies (JSON parsing only). No schema field
  changes; the batch write reuses the existing `eval_traces` shape.

## Non-goals (deferred)

- OTLP **protobuf** (`application/x-protobuf`); JSON only this change.
- OTLP **metrics** and **logs** endpoints; traces only.
- Content offload batching: content-bearing spans still record
  individually through the content path (only metadata-only spans batch).
- A component-owned public route or domain; the host mounts and guards
  the route (consistent with the host-invoked stance elsewhere).
- Full OTel semantic-convention coverage beyond the GenAI attributes and
  the core span fields.
