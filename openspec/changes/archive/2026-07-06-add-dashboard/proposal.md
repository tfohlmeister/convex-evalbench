## Why

Every capability convex-evalbench ships (tracing, datasets, the eval
runner, scorers, judges, run comparison) is reactive but headless: today
you only see it through host-written queries, `*-proof.mjs` scripts, or the
Convex data browser. The roadmap's "live dashboard" is the missing surface
that turns those reactive queries into something a person watches. Because
Convex pushes every new span and result over a subscription, a dashboard
built on these queries fills in live with no polling, which is the
product's core differentiator and is best shown, not described.

## What Changes

- Add a **companion React dashboard** as a new in-repo workspace app at
  `dashboard/`: a Vite + React 19 single-page app that connects to a Convex
  deployment with `ConvexReactClient` and subscribes to host-exposed
  evalbench queries. It is reusable: a user points it at their own
  deployment via `VITE_CONVEX_URL` and a documented set of host wrappers.
- Four views over the existing reactive queries:
  - **Traces**: recent traces list, a live-filling span tree per trace with
    per-span tokens / cost / latency (aggregated to parents) and duration
    bars, and on-demand span content (inline strings and signed URLs).
  - **Runs**: runs list, a live run summary (completed / passed /
    aggregate score), and a per-item results table showing input, expected
    output, produced output, per-scorer score columns, status, and a trace
    link, plus a redrive action for a wedged run.
  - **Datasets**: dataset list and detail with items, plus create,
    version, and archive.
  - **Compare**: pick a baseline and a candidate run, see per-item
    regressed / improved / unchanged / incomplete with score deltas, an
    aggregate score-movement summary, an on-demand side-by-side output diff,
    and the threshold gate verdict.
  - Basic client-side **filtering and search** on the traces list and the
    run results table (status filter plus free-text match).
- A small **reusable UI kit** ported from the visual language of the
  sibling `convex-orchestrator` app (Tailwind v4 `@theme` tokens plus
  `@layer components` classes): `Button` (primary / secondary / destructive
  variants), an accessible `Dialog`, `Table`, `Badge`, `Card`, `Input`,
  and `EmptyState`. Each primitive is built once and reused across views.
- **Host wrapper contract**: extend the example app's Convex functions with
  the full set of query and mutation wrappers the dashboard consumes
  (traces, runs, datasets, compare), and document them as the contract a
  host implements to run the dashboard against its own deployment.
- **Tooling**: Vite dev server with hot module reload, Vitest plus React
  Testing Library for component tests, ESLint (React plus hooks) and
  Prettier matching the repo, and a web `tsconfig`. Wired into `pnpm check`
  so the dashboard is gated like the rest of the repo.

## Capabilities

### New Capabilities
- `dashboard`: a reactive companion web UI over the evalbench queries. It
  defines the four views, the reusable UI kit and its interaction
  conventions (button semantics, confirm-to-delete dialogs, loading /
  empty / error states), the Convex client wiring, and the host wrapper
  contract the UI depends on.

### Modified Capabilities
<!-- None. The dashboard consumes the existing component queries unchanged;
     it adds host wrappers in the example app but changes no component
     capability's requirements. -->

## Impact

- **New app**: `dashboard/` (Vite, React 19, react-router-dom v7,
  `convex/react`, Tailwind v4). New dev dependencies scoped to that app
  (react, react-dom, react-router-dom, @vitejs/plugin-react, tailwindcss,
  @tailwindcss/vite, @testing-library/react, jsdom, lucide-react).
- **pnpm workspace**: `dashboard/` becomes a workspace member; root scripts
  gain `dev:dashboard`, `build:dashboard`, and the dashboard's tests join
  `pnpm check`.
- **Example app**: additional host query and mutation wrappers in
  `example/convex` so the dashboard has a complete backend to run against
  locally. No change to `src/component` or `src/client`.
- **Docs**: a new `docs/dashboard.md` (running it, the `VITE_CONVEX_URL`
  and host-wrapper contract) and a README roadmap update.

## Non-goals

- **Auth and multi-tenancy**: the dashboard is a trusted-deployment tool.
  The host owns auth; the dashboard ships no login and assumes access to
  the deployment it is pointed at. Deferred.
- **Analytics dashboards**: cost / latency / token charts over time with
  percentiles (p50/p95/p99) are a separate surface, not one of the four
  core views. Strongly expected long-term, deferred for this phase.
- **Server-side filtering, a query language, and saved views**: v1 filtering
  is client-side over the loaded window. Deferred.
- **Dark mode / theming**: single light theme matching the orchestrator
  family look. Deferred.
- **Writing datasets or starting runs from scratch in the UI beyond the
  listed create / version / archive and redrive actions**: no run
  configuration builder, no scorer editor. Deferred.
- **New ingestion sources** (OTLP, Vercel AI SDK): unrelated roadmap item,
  out of scope here.
- **Publishing the dashboard as a separately installable npm package**: it
  ships in-repo as a reference companion app for this phase.
