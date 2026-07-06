## 1. Batch ingestion seam (tracing)

- [ ] 1.1 Add a `recordSpansBatch({ spans })` mutation in
  `src/component/ingestion.ts` that inserts many metadata-only rows
  through the same internal write seam `recordSpan` uses, in one
  transaction (validate with `spanInputValidator`-metadata, no content).
  Run codegen; `pnpm check` green.
- [ ] 1.2 Add convex-test coverage: a batch of metadata-only spans is
  persisted with the same row shape as single-recorded spans, and no
  content/storage fields are written.
- [ ] 1.3 Add an `Evalbench.recordSpans(ctx, spans)` client wrapper over
  `recordSpansBatch`, best-effort like `recordSpan`.

## 2. OTLP mapping

- [ ] 2.1 Add `src/client/otlp.ts` with a pure `mapOtlpSpan(otelSpan,
  merged attributes)` -> span function per design D3: hex ids, nano ->
  ms timing and `latencyMs`, status/errorType, GenAI attribute mapping
  (`gen_ai.system`/`request.model`/`usage.*`), `kind` classification,
  remaining attributes -> `metadata`, opt-in content from GenAI
  prompt/completion attributes.
- [ ] 2.2 Unit-test `mapOtlpSpan` in isolation: GenAI llm span, a
  non-GenAI span (default kind), error status, and a malformed span
  (missing required fields) surfacing as a mapping failure.

## 3. Receiver handler

- [ ] 3.1 Add `otlpTraceHandler(options)` to `src/client/otlp.ts`
  returning `(ctx, request) => Promise<Response>`. Options `{ evalbench,
  recordContent?, authorize?, maxSpans? }`. Branch on `Content-Type`:
  `application/x-protobuf` -> `415` with the `http/json` guidance;
  non-JSON or unparseable -> `400`; run `authorize` first -> `401` on
  deny.
- [ ] 3.2 Walk `resourceSpans[].scopeSpans[].spans[]`, merge
  resource/scope attributes, map each via `mapOtlpSpan`, enforce
  `maxSpans`, group metadata-only spans and write them via
  `evalbench.recordSpans` in bounded chunks, and record content-bearing
  spans individually via `evalbench.recordSpan`.
- [ ] 3.3 Build the OTLP `ExportTraceServiceResponse`: `{}` when all
  accepted, else `{ partialSuccess: { rejectedSpans, errorMessage } }`;
  respond `200` with it.

## 4. Packaging and tests

- [ ] 4.1 Add the `./otlp` entry to the exports map in `package.json`
  (types + default under `dist/client/otlp.*`).
- [ ] 4.2 Add a handler test (convex-test http action harness or a
  direct handler call with a stub `ctx`): an OTLP/JSON export records
  mapped spans; a mixed export reports `partialSuccess` for the bad span
  at `200`; protobuf -> `415`; bad body -> `400`; denied `authorize` ->
  `401`; an over-cap export bounds and reports the overflow.

## 5. Docs

- [ ] 5.1 Add an "OTLP receiver" section to `docs/tracing.md`: mounting
  the route in `convex/http.ts`, exporter config for `http/json`, the
  auth recommendation, the protobuf limitation, and the GenAI
  semantic-convention mapping table; move the README roadmap note from
  "Next" to shipped.

## 6. Final gate

- [ ] 6.1 Final gate: `pnpm check` green (build, typecheck, tests, lint,
  dashboard check); the new mapping, batch-write, and handler tests pass
  and the existing trace/eval proofs still pass against the local
  backend.
