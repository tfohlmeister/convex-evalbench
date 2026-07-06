## Context

The tracing core records spans through `Evalbench.recordSpan(ctx, span)`,
a best-effort seam that swallows its own errors and routes content-
bearing spans through a component action, metadata-only spans through a
mutation. The one shipped adapter, `withEvalbench` (`src/client/agent.ts`),
wraps a `@convex-dev/agent` agent by mutating its handler options and its
`generate*` methods, and it describes the agent structurally so the core
builds without the optional `@convex-dev/agent` peer installed.

The Vercel AI SDK exposes a first-class extension point,
`wrapLanguageModel({ model, middleware })`, where a
`LanguageModelV2Middleware` can implement `wrapGenerate` (non-streaming)
and `wrapStream` (streaming). Both receive the resolved `params`, the
`model` (with `modelId` / `provider`), and a `doGenerate` / `doStream`
thunk. The AI SDK is normally called from inside a Convex action, so the
Convex `ctx` needed for recording is in scope at the call site.

## Goals / Non-Goals

**Goals:**
- Record one `llm` span per model call made through a wrapped AI SDK
  model, with measured latency and mapped usage/model/provider/status.
- Keep the tracing core free of any dependency on `ai` (optional peer,
  structural typing).
- Opt-in content recording, delegated to the ingestion API.
- Let a caller correlate spans with an existing trace or eval run.

**Non-Goals:**
- A synthetic per-operation root span (the middleware sits below the
  operation); cost computation; cross-operation grouping through a
  shared instance; the OTLP receiver.

## Decisions

### D1. Adapt at the `LanguageModelV2Middleware` seam

The adapter is a factory `evalbenchMiddleware(options)` returning a
`LanguageModelV2Middleware` with `wrapGenerate` and `wrapStream`. This is
the AI SDK's supported, stable extension point, and because it wraps the
call, it can time it: `startedAt` at entry, `endedAt` after the awaited
result, `latencyMs = endedAt - startedAt`. This is strictly better than
the agent adapter, whose `usageHandler` is a post-response hook with no
call-start time (so it leaves `latencyMs` unset).

### D2. Bind the Convex `ctx` at construction

Recording needs a Convex `ctx` (`runMutation` / `runAction`), which the
middleware hooks do not receive. The AI SDK is called from inside a host
action, so the host constructs the middleware there with the live `ctx`:
`evalbenchMiddleware({ evalbench, ctx })`. A middleware instance
therefore corresponds to one operation, which also gives it a natural
per-instance `traceId` (D4). Options: `{ evalbench, ctx, recordContent?,
traceId?, runId?, parentSpanId? }`.

### D3. No value import of `ai`; structural typing

The adapter never imports a value from `ai`; it types `params`, `model`,
and the middleware result structurally (only the fields it reads:
`model.modelId`, `model.provider`, `result.usage.{input,output,total}
Tokens`, `result.finishReason`, `result.content`, the stream parts). A
real `LanguageModelV2Middleware` is assignable to the returned shape.
This keeps `ai` an optional peer dependency and the core buildable and
testable without it, exactly as the agent adapter treats
`@convex-dev/agent`.

### D4. One trace per middleware instance; opt-in correlation

By default the middleware generates a `traceId` once at construction;
every model call it wraps records an `llm` span sharing that `traceId`.
Multi-step calls (tool use, `maxSteps`) thus appear as sibling spans of
one trace. No synthetic root `agent_step` is created, because the
middleware cannot observe the operation boundary from below. When the
caller supplies `traceId` / `parentSpanId` (for example an eval-run
target that must stamp `runId` and correlate to a known trace), those
are used instead, and `runId` is passed through onto the span.

### D5. Map the AI SDK generate result to span fields

- `model.modelId` -> `model`; `model.provider` -> `provider`.
- `result.usage.inputTokens` / `outputTokens` / `totalTokens` -> the
  span's token counts (only when present).
- `operationName`: `"llm call"` (kind `"llm"`); provider extras
  (`result.providerMetadata`) go into `metadata`.
- Status: a successful `doGenerate()` records `status: "success"`. If
  `doGenerate()` throws, the span records `status: "error"` with
  `errorType` from the error name, and the error is **rethrown** so the
  caller's control flow is unchanged (best-effort recording never masks
  the model error).
- Content (opt-in): input from `params.prompt`, output from the text of
  `result.content`, each `safeStringify`-d, passed to `recordSpan`
  (which handles inline-versus-File-Storage).

### D6. Streaming records at stream completion

`wrapStream` calls `doStream()` and pipes the returned stream through a
`TransformStream` that forwards every chunk unchanged and, on the
`finish` stream part (which carries `usage` and `finishReason`), captures
the final usage. The span is recorded when the stream flushes (its
`endedAt` is stream completion, `startedAt` is `wrapStream` entry). If
the stream errors, the transform records a `status: "error"` span and
re-signals the error downstream. Output content, when opted in, is the
concatenation of text deltas seen on the stream.

## Risks / Trade-offs

- **A shared middleware instance across unrelated operations merges
  their spans into one trace.** Mitigated by D2: the natural per-`ctx`
  construction is per-operation. Documented, with the `traceId` override
  as the escape hatch.
- **Flat span tree for multi-step calls.** Sibling `llm` spans under one
  `traceId` with no root. Acceptable: the tree query already assembles
  from whatever spans exist, and a caller who wants a root records an
  `agent_step` and passes `parentSpanId`. Documented as a limitation.
- **AI SDK internal types are structural, not imported.** A future
  breaking change to `LanguageModelV2Middleware` would not be caught by
  the compiler. Mitigated by a test that wraps a real `ai` model (a
  stub language model) end to end, so a shape drift fails the suite.

## Migration Plan

Additive: a new client module and a new `./ai` export; `ai` moves to an
optional peer dependency (already installed for dev). No component,
schema, or existing-API change. `pnpm check` stays green; a new
`src/client/ai.test.ts` proves generate and stream recording (mapped
usage, measured latency, opt-in content, error status/rethrow) against a
stubbed AI SDK model, and the existing trace/eval proofs are untouched.

## Open Questions

- Should the adapter also derive `costUsd` from usage and a price table?
  Deferred; cost stays caller-supplied.
- Should there be an optional helper that opens a root `agent_step`
  around an operation so multi-step traces get a tree? Deferred to a
  follow-up if flat traces prove insufficient in the dashboard.
