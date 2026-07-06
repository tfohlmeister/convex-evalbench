## 1. Adapter module

- [x] 1.1 Add `src/client/ai.ts` exporting `evalbenchMiddleware(options)`
  that returns a `LanguageModelV2Middleware`-shaped object with
  `wrapGenerate` and `wrapStream`. Options: `{ evalbench, ctx,
  recordContent?, traceId?, runId?, parentSpanId? }`. Type the AI SDK
  `params`/`model`/result and stream parts structurally (no value import
  of `ai`), mirroring how `src/client/agent.ts` types the agent.
- [x] 1.2 Implement `wrapGenerate` per design D1/D5: measure
  `startedAt`/`endedAt`, call `doGenerate()`, map `model.modelId`,
  `model.provider`, `result.usage` tokens, `providerMetadata` ->
  `metadata`; record an `llm` span via `evalbench.recordSpan` sharing the
  instance `traceId` (or the supplied one) with optional
  `parentSpanId`/`runId`; on a thrown call record an error-status span
  and rethrow.
- [x] 1.3 Implement `wrapStream` per design D6: pipe the returned stream
  through a `TransformStream` that forwards chunks and captures the
  `finish` part's usage, records the span on flush (error path records
  error status); when `recordContent`, accumulate text deltas as output.
- [x] 1.4 Add opt-in content: input from `params.prompt`, output from the
  result text, via a `safeStringify` helper (reuse the agent adapter's
  approach); pass to `recordSpan` only when `recordContent` is set.

## 2. Packaging

- [x] 2.1 Add the `./ai` entry to the exports map in `package.json`
  (types + default under `dist/client/ai.*`), mirroring `./agent`.
- [x] 2.2 Move `ai` from `devDependencies` to `peerDependencies` with
  `peerDependenciesMeta.ai.optional = true`; keep it installed for dev.

## 3. Tests

- [x] 3.1 Add `src/client/ai.test.ts` covering a wrapped stubbed model:
  `wrapGenerate` records one `llm` span with mapped model/provider/usage
  and a measured `latencyMs`; opt-in content is recorded only when
  enabled; a thrown call records an error span and rethrows; supplied
  `traceId`/`runId` land on the span; multiple calls through one instance
  share a `traceId`.
- [x] 3.2 Add a `wrapStream` test: a streaming call records exactly one
  span at stream completion with the usage from the `finish` part.

## 4. Docs

- [x] 4.1 Add a Vercel AI SDK adapter subsection to `docs/tracing.md`
  (wrapping a model, the `ctx`/trace/run options, the measured-latency
  advantage over the agent adapter, the flat-tree limitation); add an
  `example/convex` usage snippet; move the README roadmap note from
  "Next" to shipped.

## 5. Final gate

- [x] 5.1 Final gate: `pnpm check` green (build, typecheck, tests, lint,
  dashboard check); the new adapter tests pass and the existing trace/
  eval proofs still pass against the local backend.
