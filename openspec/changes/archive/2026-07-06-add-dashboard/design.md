## Context

convex-evalbench is a headless Convex component. All data (spans, runs,
results, datasets, comparisons) is already exposed through reactive queries
on the `Evalbench` client, which a host wraps and a browser subscribes to.
There is no UI: today the surface is `example/*-proof.mjs` scripts and the
Convex data browser.

The sibling app `convex-orchestrator` (`src/web`) is the visual and
ergonomic template the user asked to match. Studied directly, it is a
hand-rolled design system: React 19, Vite, react-router-dom v7 (classic
`<Routes>` shell), Tailwind v4 with CSS-first `@theme` tokens and a
`@layer components` class set (`.btn`, `.btn-primary/-accent/-ghost/-danger`,
`.pill`, `.card`, `.input`, `.eyebrow`, `.tab`), custom modals with a
colored top border and type-to-confirm for destructive actions, and no
component-library dependency (no shadcn, no Radix). One deliberate
divergence: the orchestrator's "reactivity" is REST plus polling and it
uses no Convex client at all. evalbench is reactive at the database, so the
dashboard uses real Convex subscriptions instead.

This change adds no component code and no tables. It adds a React app, a set
of host wrapper functions in the example backend, and docs.

## Goals / Non-Goals

**Goals:**
- A reusable companion SPA that renders the four evalbench areas live,
  pointed at any Convex deployment via `VITE_CONVEX_URL`.
- Visual and interaction parity with the orchestrator family: the same
  token palette, button semantics (primary / secondary / destructive), the
  same confirm-to-delete dialog pattern.
- A single reusable UI kit: every primitive (Button, Dialog, Table, Badge,
  Card, Input, EmptyState, and the state helpers Loading / Empty / Error)
  is built once and composed by all four views. No duplicated components.
- Real reactivity: `convex/react` `useQuery` subscriptions, so lists and
  trees fill in without polling.
- Gated like the rest of the repo: HMR dev loop, Vitest plus Testing
  Library component tests, ESLint and Prettier, folded into `pnpm check`.

**Non-Goals:**
- Auth, login, multi-tenant scoping (host owns auth; trusted deployment).
- Dark mode / theme switching.
- A run-config builder or scorer editor (only the listed create / version /
  archive / redrive write actions).
- Publishing the dashboard as its own npm package.

## Decisions

### Data layer: `convex/react` subscriptions, not react-query polling
The dashboard uses `ConvexReactClient` plus `ConvexProvider`, and every read
is a `useQuery(api.<hostWrapper>, args)` subscription. Writes are
`useMutation`. This is the one place the dashboard departs from the
orchestrator template, and on purpose: the whole point of evalbench is that
a trace tree and a run summary fill in live. Polling would both undersell
that and add latency and load. Alternative considered: copy the
orchestrator's `api.ts` fetch wrapper plus `@tanstack/react-query` with
`refetchInterval`. Rejected because it throws away the component's native
reactivity for no benefit.

### Deployment coupling: host wrappers, not direct component calls
A browser cannot call component functions directly; a host must expose
`query`/`mutation` wrappers (Convex does not propagate `ctx.auth` into
component code, and the component api is not addressable from the client).
The dashboard therefore talks to a documented, stable set of host function
names, consolidated into a single `example/convex/dashboard.ts` module so
the contract is one self-contained file a user copies (rather than
functions cherry-picked from the demo modules under inconsistent names
like `getComparison` / `listRunResults`). The dashboard references only
`api.dashboard.*`. The pre-existing `demo.ts` / `evalDemo.ts` wrappers are
left untouched for the `*-proof.mjs` scripts; the small duplication of a
few thin trace/compare query wrappers is the cost of a clean copy-in
contract. `docs/dashboard.md` publishes that module as the contract, so a
user copies the file into their own `convex/`, adds any auth gate, and
points the dashboard at it. Alternative considered: ship the wrappers from the component package
so a user re-exports them. Rejected for this phase because the host must
own the function identity and any auth gate; a documented copy-in contract
is simpler and matches how the component is already used.

### App placement: `dashboard/` workspace member
The app lives at repo root `dashboard/`, added to `pnpm-workspace.yaml`,
mirroring how the orchestrator co-locates `src/web` with its backend.
Developed against the `example/` deployment locally (`VITE_CONVEX_URL`
points at the local backend's URL). It builds independently
(`vite build`) and its `tsc --noEmit` plus Vitest run join `pnpm check`.
Alternative considered: nest it under `example/`. Rejected because the
dashboard is a reusable deliverable, not part of the demo backend, and a
top-level app keeps that boundary clear.

### Router: react-router-dom v7 (classic)
Matches the orchestrator. A layout shell (sidebar plus main) wraps
`<Routes>`. Routes:
`/traces`, `/traces/:traceId`, `/runs`, `/runs/:runId`, `/datasets`,
`/datasets/:datasetId`, `/compare` (with `?baseline=&candidate=` search
params). `/` redirects to `/traces`. Navigation via `<NavLink>` with an
active indicator. Alternative considered: TanStack Router (the user's first
instinct). Rejected during planning for stack consistency with the
orchestrator; revisit if typed routes become worth the divergence.

### UI kit: port the orchestrator's CSS design system, wrap the stateful bits in React
`styles.css` carries the `@theme` token block and the `@layer components`
classes verbatim from the orchestrator (warm-paper palette, ink primary,
accent CTA, ok/warn/danger/info status hues each with a tint). Purely
presentational primitives (Card, Badge/Pill, Input, eyebrow, table
scaffolding) are those classes applied via `className`. Genuinely stateful
or accessibility-sensitive widgets become small React components:
- `Button`: thin wrapper over `.btn` variants with a `variant` prop
  (`primary | secondary | destructive | ghost`) and `size`, so the semantic
  mapping lives in one place.
- `Dialog`: the orchestrator's modals are visually right but skip focus
  management. The dashboard's `Dialog` keeps the colored-top-border look and
  adds a focus trap, Escape-to-close, `aria-modal`, and a backdrop, since
  "a proper interface, no shortcuts" was explicit. `ConfirmDialog` builds on
  it for destructive actions (archive dataset, prune traces) with
  type-to-confirm.
- `DataState`: one component that renders loading / empty / error uniformly
  from a `useQuery` result (which is `undefined` while loading), so no view
  hand-rolls those three states.

### Table-stakes additions stay client-side (no component changes)
A survey of incumbent eval dashboards (Langfuse, Braintrust, LangSmith,
Weave, Phoenix) showed four elements that are table stakes and that the
first plan had left too thin: per-span tokens/cost/latency on the trace,
output/expected/per-scorer columns in the run results, an output diff plus
score deltas in compare, and basic filtering. All four are backed by data
the existing queries already return, so none requires a component or schema
change:
- Per-span metrics: `spansByTrace` already returns `inputTokens`,
  `outputTokens`, `totalTokens`, `latencyMs`, `costUsd` per span. Parent
  rollup and duration bars (scaled by `latencyMs`) are client-side.
- Run results columns: a result row already carries `output`, `scores`
  (per-scorer records), `status`, `latencyMs`, and `costUsd`. The item
  `input` and `expectedOutput` are not on the result row; the view joins
  them from the dataset items (`listItems`) by `itemId`.
- Compare diff and deltas: `compareRuns` already returns per-item baseline
  and candidate scores plus aggregate mean scores, so deltas are
  subtraction. The per-side `output` for a diff is not in the comparison
  payload; the view joins both runs' results (`listResults` for each) by
  `itemId` and diffs the outputs client-side.
- Filtering: client-side over the loaded window (recentTraces is capped at
  200, listRuns is clamped), so a status filter and free-text match need no
  query change. Server-side filtering and a query language are deferred.

The cost is a few client-side joins and one extra subscription on the
compare and run-detail views, not new backend surface. Analytics dashboards
(cost/latency percentiles over time) are the one commonly-expected element
kept deferred, since they are a separate surface rather than a gap in the
four core views.

### Icons: `lucide-react`
The orchestrator uses Unicode glyphs. For a proper interface the dashboard
uses `lucide-react` (small, tree-shakeable, standard). Minor, isolated to
presentation.

### Testing: Vitest plus React Testing Library, jsdom
Matches the repo's existing Vitest. Component tests cover the UI kit
(Button variant to class mapping, Dialog focus and Escape, ConfirmDialog
gating, DataState branches) and view logic that is pure (compare
classification to badge, run-summary derivation), using a mocked Convex
client so tests need no backend. End-to-end visual verification during
development is done manually with the `playwright-cli` skill against the
running dev server, not automated (the repo maintains e2e separately).

## Risks / Trade-offs

- **Host-wrapper drift**: the dashboard depends on host function names that
  live in example code, so a rename silently breaks a user's copy. →
  Mitigation: document the contract explicitly in `docs/dashboard.md`, keep
  the wrapper names stable, and have the example app be the single source
  the docs mirror.
- **`convex/react` and `convex` version coupling**: the dashboard pins the
  same `convex` as the repo peer range. → Mitigation: use the workspace
  `convex` version; the dashboard is dev-only, not shipped in the package
  `files`.
- **Porting the orchestrator CSS creates two copies of one design system**
  that can diverge. → Mitigation: accepted for now (the apps are separate
  repos); the tokens are small and stable. Noted as a candidate for a
  shared package only if a third consumer appears.
- **Reactive queries returning large lists** (many spans, many results)
  could make a view heavy. → Mitigation: the existing queries already cap
  and order (recentTraces capped at 200, listRuns clamped); the dashboard
  paginates the results table client-side and resolves span content only on
  demand.
- **Accessibility of the hand-rolled Dialog**: focus trap and Escape are
  easy to get subtly wrong. → Mitigation: cover open/close, focus-in,
  Escape, and backdrop-click in component tests.

## Migration Plan

Additive only. No component, schema, client, or existing example function
changes are altered destructively; new host wrappers are added alongside the
existing ones. The dashboard is a new workspace app excluded from the
published package `files`. Rollback is deleting the `dashboard/` directory
and its workspace entry and script lines. No data migration.

## Open Questions

- None blocking. Deferred by decision: auth, dark mode, extracting the
  shared design system into its own package.
