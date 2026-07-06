## Context

Convex HTTP endpoints are `httpAction`s mounted by the host in
`convex/http.ts`; they run with an `ActionCtx` (so `runMutation` /
`runAction`, and thus `Evalbench.recordSpan`, are available) and outside
the host's app auth. A component cannot own a public route on the host's
domain, so, as with `redriveRun` and `pruneTraces`, the library ships the
operation and the host wires it.

OTLP over HTTP (`OTEL_EXPORTER_OTLP_PROTOCOL`) has two encodings:
`http/protobuf` (default in many exporters) and `http/json`. The JSON
encoding is a straightforward, well-specified shape:
`resourceSpans[].scopeSpans[].spans[]`, each span carrying hex
`traceId` / `spanId` / `parentSpanId`, `name`, `startTimeUnixNano` /
`endTimeUnixNano`, a `status` (`code` UNSET/OK/ERROR, `message`), a
`kind`, and typed `attributes[]`. Convex's runtime has no native protobuf
and no `Buffer`; decoding `http/protobuf` would require bundling a
pure-JS protobuf runtime plus the OTLP proto descriptors.

The tracing capability already funnels all writes through one internal
seam specifically so batching can be added without changing callers. A
high-volume receiver is the first source that needs it: a single OTLP
export commonly carries hundreds of spans, and one Convex mutation per
span would be slow and could exceed an action's time budget.

## Goals / Non-Goals

**Goals:**
- Accept OTLP/JSON trace exports at a host-mounted route and record their
  spans through the tracing ingestion API.
- Map OTel spans, and GenAI semantic-convention attributes, onto span
  fields.
- Report partial success per the OTLP spec instead of failing an export.
- Ingest many spans per request efficiently (batch metadata write).
- Give the host an auth hook and a bounded per-request cost.

**Non-Goals:**
- OTLP protobuf, metrics, or logs; full semantic-convention coverage; a
  component-owned route; batching of content-bearing spans.

## Decisions

### D1. A handler factory the host mounts

Export `otlpTraceHandler(options)` returning an
`(ctx, request) => Promise<Response>` function the host wraps in
`httpAction` and routes at a path of its choosing (conventionally
`/v1/traces`). Options: `{ evalbench, recordContent?, authorize?,
maxSpans? }`. This mirrors the existing host-wires-it stance and keeps
auth and the route path in the host.

### D2. OTLP/JSON only; protobuf answered with 415

The handler branches on `Content-Type`. `application/json` is parsed and
mapped. `application/x-protobuf` returns `415 Unsupported Media Type`
with a body telling the operator to set the exporter to `http/json`
(`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`). Rationale: no native protobuf
in the runtime, and a pure-JS OTLP protobuf decoder is disproportionate
for the first iteration. Protobuf is a documented follow-up. A JSON body
that fails to parse or is not shaped like an OTLP request returns `400`.

### D3. OTel span -> span field mapping

For each span in `resourceSpans[].scopeSpans[].spans[]`:
- `traceId` / `spanId` / `parentSpanId`: kept as their hex strings (span
  ids are opaque strings in evalbench); an empty/absent `parentSpanId`
  marks a root.
- `startedAt = startTimeUnixNano / 1e6`, `endedAt = endTimeUnixNano /
  1e6`, `latencyMs = endedAt - startedAt` (nanoseconds to milliseconds).
- `status`: OTel `ERROR` -> `"error"` (with `errorType` from
  `status.message` or an `exception.type` attribute), otherwise
  `"success"`.
- `operationName = span.name`.
- `kind`: if `gen_ai.*` attributes are present -> `"llm"`; else a small
  heuristic (spans that look like tool calls -> `"tool"`) with a default
  of `"workflow_step"`. Resource + scope attributes merge under the span.
- GenAI conventions: `gen_ai.system` -> `provider`,
  `gen_ai.request.model` (or `gen_ai.response.model`) -> `model`,
  `gen_ai.usage.input_tokens` / `output_tokens` -> token counts (and
  their sum -> `totalTokens` when not given). Remaining attributes go
  into `metadata`.
- Content (opt-in): `gen_ai.prompt` / `gen_ai.input.messages` ->
  `input`, `gen_ai.completion` / `gen_ai.output.messages` -> `output`,
  stringified; recorded only when `recordContent` is set.

### D4. Partial success, not all-or-nothing

Each span is mapped and recorded independently. A span that fails to map
(missing required fields, bad timestamps) is skipped and counted; a
recording failure is already swallowed by `recordSpan`. The handler
returns `200` with an OTLP `ExportTraceServiceResponse` body: empty
`{}` when all spans were accepted, or `{ partialSuccess: { rejectedSpans,
errorMessage } }` when some were skipped. This is what OTLP exporters
expect and it keeps one bad span from dropping a whole export.

### D5. Batch metadata write through the existing seam

Add a component function `recordSpansBatch(spans)` that inserts many
metadata-only rows through the same internal write seam `recordSpan`
uses, in one transaction, and an `Evalbench.recordSpans(ctx, spans)`
client method. The receiver groups content-free mapped spans and writes
them in bounded chunks via `recordSpans`; spans that carry content still
go through the existing content path (`recordSpan`) individually, since
content routing (inline vs File Storage) needs the per-span action path.
This is the anticipated evolution of the "single write seam" requirement,
so it modifies the `tracing` capability rather than bypassing it.

### D6. Bounded spans per request

`maxSpans` (default e.g. 1000) caps how many spans one request ingests;
spans beyond the cap are rejected into `partialSuccess.rejectedSpans`
with a clear message, so a single oversized export cannot exhaust the
action budget. Combined with batching (D5), a within-cap export writes in
a small number of transactions.

### D7. Authorization is the host's, via an optional hook

`authorize?(request): boolean | Promise<boolean>` runs before parsing;
returning false answers `401`. The default is no check (open), but the
docs flag an open OTLP endpoint as an abuse vector and show a bearer /
shared-secret check. Auth stays in the host, where the credential policy
lives.

## Risks / Trade-offs

- **JSON-only excludes protobuf-default exporters.** Operators must set
  `http/json`. Documented prominently; protobuf is a named follow-up.
- **An open endpoint invites junk spans.** Mitigated by the `authorize`
  hook, the `maxSpans` cap, and the docs' auth recommendation.
- **Very large exports are truncated (partial success).** Exporters that
  honor `partialSuccess` will log it; the operator lowers batch size or
  raises `maxSpans`. Bounded cost is the deliberate trade.
- **Mapping is GenAI-convention-centric.** Non-LLM OTel spans still
  record (as `workflow_step`/`tool`) but with sparser fields. Acceptable:
  the receiver targets LLM telemetry.

## Migration Plan

Additive: a new client module, a new `./otlp` export, one new component
ingestion function behind the existing seam, and one new client method.
No schema field changes, no change to existing ingestion callers. `pnpm
check` stays green; convex-tests prove the OTel->span mapping (GenAI
attributes, timing, status), the batch write, partial-success on a
malformed span, the `415` protobuf branch, and the `authorize` `401`
path.

## Open Questions

- Add OTLP protobuf via a bundled pure-JS decoder later, or rely on
  exporters' `http/json`? Deferred; JSON-only ships first.
- Should `recordSpansBatch` also accept content-bearing spans by
  offloading inside the batch? Deferred; content spans stay on the
  per-span action path for now.
