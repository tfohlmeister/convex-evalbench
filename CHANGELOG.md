# Changelog

## [0.2.0](https://github.com/tfohlmeister/convex-evalbench/compare/v0.1.0...v0.2.0) (2026-07-06)


### Features

* add datasets, eval runner, and deterministic scorers ([8136e93](https://github.com/tfohlmeister/convex-evalbench/commit/8136e93df24a74e4a1c899151a2e69979fb28f4b))
* add host-invoked trace retention (pruneTraces) ([041e437](https://github.com/tfohlmeister/convex-evalbench/commit/041e437b9e8805080c3d432355ce361c2f22ea11))
* add judges, semantic scorers, and stuck-run recovery ([23a264e](https://github.com/tfohlmeister/convex-evalbench/commit/23a264e09873bd0a47290053c64daec625bf9d40))
* add OTLP/JSON trace receiver and batch ingestion ([48f88bc](https://github.com/tfohlmeister/convex-evalbench/commit/48f88bc02c355150d9c369f8793542a6050f7b97))
* add reactive dashboard (traces, runs, datasets, compare) ([26167d4](https://github.com/tfohlmeister/convex-evalbench/commit/26167d4803b193aaeae9af85a74f2a3f9f81e4a4))
* add run comparison and CI regression gate ([e92cb68](https://github.com/tfohlmeister/convex-evalbench/commit/e92cb689d1ff1d84e1e57c41c489d5c3860ff4a4))
* add Vercel AI SDK adapter (evalbenchMiddleware) ([fb74b55](https://github.com/tfohlmeister/convex-evalbench/commit/fb74b55dc903415bb4c45a1a781217a55848833a))


### Bug Fixes

* **deps:** patch vite and ws security advisories ([661e669](https://github.com/tfohlmeister/convex-evalbench/commit/661e669f56108d09f504f07f2e3ff54312711795))

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
