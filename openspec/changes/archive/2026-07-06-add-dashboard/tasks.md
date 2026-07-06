## 1. Scaffold the dashboard workspace app

- [x] 1.1 Create `dashboard/` with `package.json` (react 19, react-dom, react-router-dom v7, convex, @vitejs/plugin-react, tailwindcss + @tailwindcss/vite, lucide-react; dev: vitest, @testing-library/react, @testing-library/user-event, jsdom, @types/react, @types/react-dom).
- [x] 1.2 Add `dashboard` to `pnpm-workspace.yaml`; add `dev:dashboard` and `build:dashboard` scripts to the root `package.json`.
- [x] 1.3 Add `dashboard/vite.config.ts` (react + tailwind plugins, dev server port), `dashboard/tsconfig.json` (web libs, react-jsx, strict), `dashboard/index.html`, and `dashboard/src/main.tsx` rendering a placeholder. Verify `pnpm --filter` build and `tsc --noEmit` pass.
- [x] 1.4 Add ESLint (react + react-hooks) and Prettier config for the dashboard, consistent with the repo; add `.env.example` documenting `VITE_CONVEX_URL`. (eslint-plugin-react dropped: incompatible with ESLint 10; react-hooks retained, TS covers the rest. Prettier inherits the repo-root config.)

## 2. Design system and reusable UI kit

- [x] 2.1 Port the orchestrator design tokens and component classes into `dashboard/src/styles.css` (Tailwind v4 `@theme` block; `.btn`/variants, `.pill`, `.card`, `.input`, `.eyebrow`, table scaffolding).
- [x] 2.2 Build `Button` (variant: primary | secondary | destructive | ghost; size) over the `.btn` classes.
- [x] 2.3 Build accessible `Dialog` (focus trap, Escape to close, `aria-modal`, backdrop, colored top border) and `ConfirmDialog` (destructive, type-to-confirm) on top of it.
- [x] 2.4 Build `Card`, `Badge` (status tones), `Input`, `Table` scaffolding, `EmptyState`, and a `DataState` helper that renders loading / empty / error from a `useQuery` result.

## 3. Convex client, shell, and routing

- [x] 3.1 Create the `ConvexReactClient` from `VITE_CONVEX_URL` and wrap the app in `ConvexProvider` in `main.tsx`.
- [x] 3.2 Build the layout shell (sidebar with the four areas + main region) and wire react-router-dom routes: `/traces`, `/traces/:traceId`, `/runs`, `/runs/:runId`, `/datasets`, `/datasets/:datasetId`, `/compare`; `/` redirects to `/traces`; active-link indication.

## 4. Host wrapper contract (example backend)

- [x] 4.1 Consolidate the full contract into a single `example/convex/dashboard.ts` module with stable, consistently-named wrappers: traces (`listRecentTraces`, `spansByTrace`, `spanContent`), datasets (`listDatasets`, `listItems`, `createDataset`, `versionDataset`, `archiveDataset`), runs (`listAllRuns`, `listRuns`, `runSummary`, `listResults`, `redriveRun`), compare (`compareRuns`, `evaluateGate`). One self-contained copy-in file, so the dashboard references only `api.dashboard.*`. Demo/evalDemo wrappers left untouched for the proof scripts.
- [x] 4.2 Confirm `pnpm check` stays green with the new example functions (typecheck of `example/convex`).

## 5. Traces view

- [x] 5.1 Recent-traces list subscribed to the host wrapper, newest first, with the shared `DataState` states; row links to the trace detail route.
- [x] 5.2 Trace detail: subscribe to the span-tree query, assemble the tree from `parentSpanId`, render it live-filling; per span show status, tokens, cost, latency, with tokens/cost rolled up to parents and a duration bar scaled by `latencyMs` (falling back to `endedAt - startedAt` when latency is unrecorded).
- [x] 5.3 On-demand span content: expand a span to resolve content (inline strings shown directly, a link for File-Storage content).
- [x] 5.4 Basic client-side filter/search on the traces list (status filter + free-text match on operation name / id) via the shared filter control.

## 6. Runs view

- [x] 6.1 Runs list subscribed to the host wrapper (across datasets via `listAllRuns`, dataset name joined from `listDatasets`), linking to run detail, with status/text filter.
- [x] 6.2 Run detail: live run summary (completed / passed / aggregate score) + per-item results table joining dataset items by `itemId` to show input, expected output, produced output, a column per scorer, aggregate item score, status, and trace link; client-side pagination; the shared filter/search control.
- [x] 6.3 Redrive action (secondary button + mutation) for a wedged run, shown only when the run is `running`, reflected live in the summary. Wrapper path smoke-tested (no-op on a completed run); the mutation itself is covered by `runner.test.ts`.

## 7. Datasets view

- [x] 7.1 Dataset list + detail (items table), subscribed to the host wrappers; archived hidden by default with a "Show archived" toggle.
- [x] 7.2 Create-dataset dialog (accent action, name + description + optional JSON items) and version action; new/updated dataset appears live and the view navigates to it. Verified end-to-end in the browser (create) and via wrapper smoke test (version).
- [x] 7.3 Archive action via `ConfirmDialog` (destructive, type-to-confirm; button gated until the name is typed). Verified end-to-end in the browser.

## 8. Compare view

- [x] 8.1 Dataset + baseline + candidate run pickers over the same dataset, encoded in the URL search params (shareable); verified by loading a share URL directly.
- [x] 8.2 Per-item comparison table (regressed / improved / unchanged / incomplete via `Badge`) with per-item score delta, an aggregate score-movement summary (classification counts + mean-score change), and the gate verdict, updating live.
- [x] 8.3 On-demand side-by-side output diff for a selected item, joining both runs' `listResults` by `itemId`, with changed lines highlighted. Verified on the regressed item (WORLD vs world).

## 9. Tests

- [x] 9.1 UI-kit tests (Vitest + Testing Library, jsdom): Button variant-to-class mapping, Dialog focus/Escape/backdrop/trap, ConfirmDialog gating, DataState branches (loading/empty/error/success).
- [x] 9.2 View-logic tests for pure derivations: compare classification to badge, aggregate score movement + per-item delta (lineDiff), per-span token/cost rollup and duration-bar scaling, result join + scorer columns, and the client-side list filter.
- [x] 9.3 Fold the dashboard's `tsc --noEmit`, tests, and lint into root `pnpm check` (via `check:dashboard`); full gate green (root 89 + dashboard 52 tests).

## 10. Docs

- [x] 10.1 Write `docs/dashboard.md`: running it (`VITE_CONVEX_URL`, dev + build), the host wrapper contract (names + shapes), and the interaction conventions. Update the README roadmap (dashboard shipped) and references.

## 11. Verification

- [x] 11.1 Drove the dashboard with `playwright-cli` against the local example deployment: span tree fills in live (span count 3→4 via `addDemoSpan` with no reload); run detail shows output/expected/per-scorer columns with trace links; list filter narrows (29→7) and shows the empty message; create + type-to-confirm archive dataset flow; compare shows score deltas, output diff (WORLD vs world), and the gate verdict; console clean (0 errors/warnings). Screenshots captured.
