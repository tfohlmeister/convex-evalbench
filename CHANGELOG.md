# Changelog

## 0.1.0 (2026-07-05)

### Added

- **Tracing core.** Record every LLM call as a span inside your own
  Convex deployment.
  - `eval_traces` table with a source-agnostic span model (`llm`, `tool`,
    `agent_step`, `workflow_step`, `judge` kinds; tokens, model, provider,
    latency, status, error type).
  - `Evalbench` client class: `recordSpan`, `spansByTrace`,
    `recentTraces`, `spanContent`. Recording is best-effort; a failure is
    logged and swallowed, never thrown back into your LLM call.
  - Reactive queries return metadata only, so live span-tree
    subscriptions stay small. Raw `input`/`output` content is opt-in;
    content at or below 4 KB is stored inline, larger content is
    offloaded to Convex File Storage and resolved on demand via
    `spanContent`.
- **`@convex-dev/agent` adapter.** `withEvalbench(agent)` wraps an agent
  so each LLM call is recorded as a span, composing with any
  `usageHandler` / `rawRequestResponseHandler` you already set. LLM calls
  within one `generateText` / `generateObject` operation share a trace
  and link to a root `agent_step` span. `@convex-dev/agent` is an
  optional peer dependency.
- **Test helper.** `convex-evalbench/test` registers the component
  schema for `convex-test`-based host tests.
- **Example app.** `example/convex` with a generic-API live proof and a
  wrapped-agent proof against a local Convex backend.
