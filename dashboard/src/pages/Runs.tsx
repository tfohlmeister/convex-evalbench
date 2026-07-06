import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ListChecks, RotateCw } from "lucide-react";
import { api } from "../lib/convex";
import type { Run } from "../lib/types";
import { runStatusTone, resultStatusTone } from "../lib/status";
import {
  joinResults,
  scoreFor,
  scorerNames,
  type JoinedResult,
} from "../lib/runResults";
import { EMPTY_FILTER, filterList, type FilterState } from "../lib/filter";
import {
  formatCost,
  formatDuration,
  formatScore,
  formatTime,
  stringifyValue,
  truncate,
} from "../lib/format";
import { Badge, Button, Card, DataState, SectionHeader, Table } from "../ui";
import { FilterBar } from "../components/FilterBar";

const RUN_STATUSES = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "queued", label: "Queued" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
];

const RESULT_STATUSES = [
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
  { value: "running", label: "Running" },
  { value: "pending", label: "Pending" },
];

function RunStatusBadge({ status }: { status: Run["status"] }) {
  const tone = runStatusTone(status);
  return (
    <Badge tone={tone.tone} live={tone.live}>
      {status}
    </Badge>
  );
}

export function RunsPage() {
  const runs = useQuery(api.dashboard.listAllRuns, { limit: 200 });
  const datasets = useQuery(api.dashboard.listDatasets, {
    includeArchived: true,
  });
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);

  const datasetName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of datasets ?? []) map.set(d._id, `${d.name} v${d.version}`);
    return map;
  }, [datasets]);

  const rows = useMemo(
    () =>
      runs
        ? filterList(
            runs,
            filter,
            (r) => [
              r.targetVersion,
              r.triggeredBy,
              datasetName.get(r.datasetId),
              r._id,
            ],
            (r) => r.status,
          )
        : [],
    [runs, filter, datasetName],
  );

  return (
    <div>
      <SectionHeader eyebrow="Evaluation" title="Runs" />
      <FilterBar
        value={filter}
        onChange={setFilter}
        statuses={RUN_STATUSES}
        placeholder="Search version, trigger, dataset…"
      />
      <Card>
        <DataState
          data={runs}
          loadingLabel="Loading runs"
          emptyIcon={<ListChecks size={28} />}
          emptyTitle="No runs yet"
          emptyHint="Start an eval run with the evalbench client and it appears here live."
        >
          {() =>
            rows.length === 0 ? (
              <p className="text-[13px] text-[var(--color-soft)] px-4 py-8 text-center">
                No runs match the filter.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Dataset</th>
                    <th>Status</th>
                    <th className="text-right">Progress</th>
                    <th className="text-right">Passed</th>
                    <th className="text-right">Score</th>
                    <th className="text-right">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r._id}>
                      <td>
                        <Link
                          to={`/runs/${r._id}`}
                          className="font-mono text-[13px] text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                        >
                          {r.targetVersion ?? truncate(r._id, 16)}
                        </Link>
                        {r.triggeredBy && (
                          <span className="text-[11px] text-[var(--color-soft)] ml-2">
                            {r.triggeredBy}
                          </span>
                        )}
                      </td>
                      <td className="text-[12px] text-[var(--color-muted)]">
                        {datasetName.get(r.datasetId) ?? "—"}
                      </td>
                      <td>
                        <RunStatusBadge status={r.status} />
                      </td>
                      <td className="text-right font-mono text-[12px]">
                        {r.completedCount}/{r.itemCount}
                      </td>
                      <td className="text-right font-mono text-[12px]">
                        {r.passedCount}/{r.completedCount}
                      </td>
                      <td className="text-right font-mono text-[12px]">
                        {formatScore(r.summaryScore)}
                      </td>
                      <td className="text-right text-[12px] text-[var(--color-soft)] whitespace-nowrap">
                        {formatTime(r.startedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          }
        </DataState>
      </Card>
    </div>
  );
}

const PAGE_SIZE = 25;

export function RunDetailPage() {
  const { runId = "" } = useParams();
  const summary = useQuery(api.dashboard.runSummary, { runId });
  const results = useQuery(api.dashboard.listResults, { runId });
  const items = useQuery(
    api.dashboard.listItems,
    summary ? { datasetId: summary.datasetId } : "skip",
  );
  const redrive = useMutation(api.dashboard.redriveRun);

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [page, setPage] = useState(0);
  const [redriving, setRedriving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const scorers = useMemo(() => scorerNames(results ?? []), [results]);
  const joined = useMemo(
    () => joinResults(results ?? [], items ?? []),
    [results, items],
  );
  const filtered = useMemo(
    () =>
      filterList(
        joined,
        filter,
        (j) => [
          stringifyValue(j.item?.input),
          stringifyValue(j.result.output),
        ],
        (j) => j.result.status,
      ),
    [joined, filter],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    clampedPage * PAGE_SIZE,
    clampedPage * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <div>
      <Link
        to="/runs"
        className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-soft)] hover:text-[var(--color-ink)] mb-3"
      >
        <ArrowLeft size={13} /> Runs
      </Link>
      <DataState
        data={summary}
        loadingLabel="Loading run"
        emptyTitle="Run not found"
      >
        {(run) => (
          <>
            <SectionHeader
              eyebrow="Run"
              title={
                <span className="font-mono text-[20px]">
                  {run.targetVersion ?? truncate(run._id, 20)}
                </span>
              }
              actions={
                run.status === "running" ? (
                  <Button
                    variant="secondary"
                    disabled={redriving}
                    onClick={async () => {
                      setRedriving(true);
                      setActionError(null);
                      try {
                        await redrive({ runId });
                      } catch (e) {
                        setActionError(
                          e instanceof Error ? e.message : String(e),
                        );
                      } finally {
                        setRedriving(false);
                      }
                    }}
                  >
                    <RotateCw size={13} /> {redriving ? "Redriving…" : "Redrive"}
                  </Button>
                ) : undefined
              }
            />

            {actionError && (
              <p className="text-[12px] text-[var(--color-danger)] mb-3">
                Redrive failed: {actionError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mb-6">
              <Stat label="Status">
                <RunStatusBadge status={run.status} />
              </Stat>
              <Stat label="Completed">
                {run.completedCount} / {run.itemCount}
              </Stat>
              <Stat label="Passed">
                {run.passedCount} / {run.completedCount}
              </Stat>
              <Stat label="Score">{formatScore(run.summaryScore)}</Stat>
              {run.triggeredBy && (
                <Stat label="Trigger">{run.triggeredBy}</Stat>
              )}
              <Stat label="Started">{formatTime(run.startedAt)}</Stat>
            </div>

            <FilterBar
              value={filter}
              onChange={(f) => {
                setFilter(f);
                setPage(0);
              }}
              statuses={RESULT_STATUSES}
              placeholder="Search input or output…"
            />

            <Card>
              <DataState
                data={results}
                loadingLabel="Loading results"
                emptyIcon={<ListChecks size={28} />}
                emptyTitle="No results yet"
                emptyHint="Items appear here as workers finalize them."
              >
                {() =>
                  filtered.length === 0 ? (
                    <p className="text-[13px] text-[var(--color-soft)] px-4 py-8 text-center">
                      No results match the filter.
                    </p>
                  ) : (
                    <>
                      <Table>
                        <thead>
                          <tr>
                            <th>Input</th>
                            <th>Expected</th>
                            <th>Output</th>
                            {scorers.map((s) => (
                              <th key={s} className="text-right">
                                {s}
                              </th>
                            ))}
                            <th className="text-right">Score</th>
                            <th>Status</th>
                            <th>Trace</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((j) => (
                            <ResultRow
                              key={j.result._id}
                              joined={j}
                              scorers={scorers}
                            />
                          ))}
                        </tbody>
                      </Table>
                      {pageCount > 1 && (
                        <Pagination
                          page={clampedPage}
                          pageCount={pageCount}
                          total={filtered.length}
                          onPage={setPage}
                        />
                      )}
                    </>
                  )
                }
              </DataState>
            </Card>
          </>
        )}
      </DataState>
    </div>
  );
}

function ResultRow({
  joined,
  scorers,
}: {
  joined: JoinedResult;
  scorers: string[];
}) {
  const { result, item } = joined;
  const tone = resultStatusTone(result.status);
  return (
    <tr>
      <td className="max-w-[16rem]">
        <Cell value={stringifyValue(item?.input)} />
      </td>
      <td className="max-w-[16rem]">
        <Cell value={stringifyValue(item?.expectedOutput)} muted />
      </td>
      <td className="max-w-[16rem]">
        <Cell value={stringifyValue(result.output)} />
      </td>
      {scorers.map((s) => {
        const score = scoreFor(result, s);
        return (
          <td key={s} className="text-right font-mono text-[12px]">
            {score ? (
              <span
                className={
                  score.passed
                    ? "text-[var(--color-ok)]"
                    : "text-[var(--color-danger)]"
                }
              >
                {formatScore(score.score)}
              </span>
            ) : (
              "—"
            )}
          </td>
        );
      })}
      <td className="text-right font-mono text-[12px]">
        {formatScore(result.itemScore)}
        {result.latencyMs !== undefined && (
          <span className="block text-[10px] text-[var(--color-soft)]">
            {formatDuration(result.latencyMs)}
            {result.costUsd ? ` · ${formatCost(result.costUsd)}` : ""}
          </span>
        )}
      </td>
      <td>
        <Badge tone={tone.tone} live={tone.live}>
          {result.status}
        </Badge>
      </td>
      <td>
        {result.traceId ? (
          <Link
            to={`/traces/${encodeURIComponent(result.traceId)}`}
            className="text-[12px] text-[var(--color-link)] underline"
          >
            open
          </Link>
        ) : (
          <span className="text-[var(--color-soft)]">—</span>
        )}
      </td>
    </tr>
  );
}

function Cell({ value, muted = false }: { value: string; muted?: boolean }) {
  if (value === "") return <span className="text-[var(--color-soft)]">—</span>;
  return (
    <span
      className={`font-mono text-[12px] whitespace-pre-wrap break-words line-clamp-3 ${muted ? "text-[var(--color-muted)]" : "text-[var(--color-ink)]"}`}
      title={value}
    >
      {truncate(value, 160)}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="text-[15px] font-mono text-[var(--color-ink)]">
        {children}
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-rule)]">
      <span className="text-[12px] text-[var(--color-soft)] font-mono">
        {total} results · page {page + 1}/{pageCount}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
