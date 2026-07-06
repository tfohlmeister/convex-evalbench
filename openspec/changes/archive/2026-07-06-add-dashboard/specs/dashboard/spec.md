## ADDED Requirements

### Requirement: Reactive Convex connection

The dashboard SHALL connect to a Convex deployment using `ConvexReactClient`
configured from a `VITE_CONVEX_URL` environment variable, and SHALL read all
data through `convex/react` `useQuery` subscriptions so views update live as
the deployment's reactive queries change, without polling. Writes SHALL use
`useMutation`.

#### Scenario: Views update live over a subscription

- **WHEN** the dashboard subscribes to a list or tree query and a new row is
  written to the deployment
- **THEN** the affected view re-renders with the new data pushed over the
  subscription, with no manual refresh or polling interval

#### Scenario: Deployment URL comes from configuration

- **WHEN** the dashboard starts with `VITE_CONVEX_URL` set to a deployment
- **THEN** the client connects to that deployment, so the same build runs
  against the example deployment or a user's own deployment by configuration
  alone

### Requirement: Application shell and navigation

The dashboard SHALL present a persistent layout shell (a sidebar with the
four areas and a main content region) and route between the areas with
react-router-dom. The root path SHALL redirect to the traces view. The
active area SHALL be indicated in the navigation.

#### Scenario: Navigating between areas

- **WHEN** the user selects a different area in the sidebar
- **THEN** the main region shows that area's view, the URL reflects the
  route, and the sidebar marks the current area active

#### Scenario: Root redirect

- **WHEN** the user opens the root path
- **THEN** the dashboard redirects to the traces view

### Requirement: Traces view

The dashboard SHALL show a list of recent traces newest first, and on
selecting one SHALL show that trace as a span tree assembled from
`parentSpanId`, filling in live as new spans arrive. Each span node SHALL
display its status and, where recorded, its token counts, cost, and latency,
with token counts and cost aggregated onto parent spans. Spans SHALL convey
relative duration (a duration bar scaled by latency). Span content
(input/output) SHALL be resolved only on demand, showing inline strings
directly and offering a link for content held in File Storage.

#### Scenario: Live-filling span tree

- **WHEN** the user opens a trace whose spans are still being recorded
- **THEN** the tree renders the spans present so far and new spans appear as
  they are recorded, without the user refreshing

#### Scenario: Per-span metrics and duration

- **WHEN** a span records token counts, cost, or latency
- **THEN** the span node shows those metrics, a parent span shows the
  aggregated tokens and cost of its subtree, and each span shows a duration
  bar scaled by its latency

#### Scenario: On-demand span content

- **WHEN** the user expands a span's content
- **THEN** the dashboard resolves that span's content, showing inline text
  directly and a fetchable link for content stored in File Storage, rather
  than loading all content up front

### Requirement: Runs view

The dashboard SHALL list eval runs and, on selecting one, SHALL show a live
run summary (completed, passed, and aggregate score) alongside a per-item
results table. Each row SHALL show the item's input and expected output
(joined from the dataset), the produced output, the status, each scorer's
score as its own column alongside the aggregate item score, and a link to
its trace. The view SHALL offer a redrive action for a wedged run.

#### Scenario: Live run summary

- **WHEN** the user watches a run that is still executing
- **THEN** the summary counters and the results table fill in live as each
  item completes

#### Scenario: Output against expected, per scorer

- **WHEN** the user views a run's results
- **THEN** each row shows the produced output next to the expected output
  and a column per scorer with that scorer's score, so output-versus-expected
  and per-scorer outcomes are visible without opening the trace

#### Scenario: Redrive a wedged run

- **WHEN** the user triggers redrive on a run that has stalled
- **THEN** the dashboard calls the redrive mutation and the run resumes,
  reflected live in the summary

### Requirement: Datasets view

The dashboard SHALL list datasets and show a selected dataset's items, and
SHALL provide create, version, and archive actions. Archiving is destructive
and SHALL require an explicit confirmation before it is applied.

#### Scenario: Create a dataset

- **WHEN** the user completes the create-dataset dialog
- **THEN** the dashboard creates the dataset and it appears in the list live

#### Scenario: Archiving requires confirmation

- **WHEN** the user chooses to archive a dataset
- **THEN** the dashboard requires an explicit confirmation, and only applies
  the archive after the user confirms

### Requirement: Compare view

The dashboard SHALL let the user choose a baseline run and a candidate run
over the same dataset and SHALL show the per-item comparison classifying
each item as regressed, improved, unchanged, or incomplete, together with
the per-item score delta, an aggregate score-movement summary (counts of
regressed and improved items and the change in mean score), and the
threshold gate verdict. For a selected item the dashboard SHALL show a
side-by-side diff of the candidate output against the baseline output,
resolved on demand. The selected runs SHALL be reflected in the URL so a
comparison is shareable.

#### Scenario: Per-item comparison and gate

- **WHEN** the user selects a baseline and a candidate run
- **THEN** the dashboard shows each item's classification, its score delta,
  the aggregate score movement, and the overall gate verdict, updating live
  if either run is still completing

#### Scenario: Output diff for a regressed item

- **WHEN** the user opens a compared item
- **THEN** the dashboard shows the candidate output side by side with the
  baseline output, highlighting the difference, so the user sees what
  changed without opening two separate traces

#### Scenario: Comparison is shareable via the URL

- **WHEN** a comparison of two runs is shown
- **THEN** the baseline and candidate are encoded in the URL so opening that
  URL reproduces the same comparison

### Requirement: Filtering and search

The traces list and the run results table SHALL offer basic filtering and
text search over the loaded rows: filter by status, and free-text match on
identifying fields (for example operation name or id). Filtering operates
client-side over the currently subscribed window of rows; a server-side
query language and saved views are out of scope for this phase.

#### Scenario: Filter a list by status and text

- **WHEN** the user sets a status filter or types a search term on the
  traces list or the run results table
- **THEN** the view narrows to the rows that match, over the currently
  loaded window, without a full-text server query

### Requirement: Reusable UI kit and interaction conventions

The dashboard SHALL provide a single set of reusable primitives (button,
dialog, table, badge, card, input, and a uniform loading/empty/error state
helper) that every view composes, rather than reimplementing these per view.
Buttons SHALL express semantic intent: a primary variant for the main
action, a secondary variant for cancel and non-primary actions, and a
destructive variant for actions that delete or discard. Modal dialogs SHALL
be accessible: focus moves into the dialog on open, Escape closes it, and
focus is constrained while it is open.

#### Scenario: Consistent button semantics

- **WHEN** a view renders an action that deletes or discards data
- **THEN** it uses the destructive button variant, visually distinct from
  primary and secondary actions, using the shared button primitive

#### Scenario: Accessible dialog

- **WHEN** a dialog opens
- **THEN** focus moves into the dialog, Escape closes it, and focus stays
  within the dialog while it is open

#### Scenario: Uniform data states

- **WHEN** a subscription is loading, returns no rows, or errors
- **THEN** the view renders the shared loading, empty, or error state
  respectively, rather than a per-view ad hoc treatment

### Requirement: Host wrapper contract

The dashboard SHALL depend only on a documented set of host-exposed query
and mutation wrappers (not on component functions directly), and the example
app SHALL implement that full set so the dashboard runs against the local
deployment. The contract SHALL be documented so a user can implement the
same wrappers in their own deployment.

#### Scenario: Dashboard runs against the example deployment

- **WHEN** the example app is deployed and the dashboard is pointed at it
- **THEN** every view has a corresponding host wrapper to subscribe to or
  call, and the dashboard functions end to end

#### Scenario: Contract is documented for reuse

- **WHEN** a user wants to run the dashboard against their own deployment
- **THEN** the documentation lists the required host wrapper functions and
  their shapes, so the user implements them and points the dashboard at
  their deployment
