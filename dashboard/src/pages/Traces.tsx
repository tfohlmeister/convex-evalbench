import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronRight, Activity, ArrowLeft } from "lucide-react";
import { api } from "../lib/convex";
import type { Span } from "../lib/types";
import {
  buildSpanTree,
  durationFraction,
  flattenTree,
  spanDurationMs,
  type SpanNode,
} from "../lib/spanTree";
import { EMPTY_FILTER, filterList, type FilterState } from "../lib/filter";
import { spanStatusTone } from "../lib/status";
import {
  formatCost,
  formatDuration,
  formatTime,
  formatTokens,
  stringifyValue,
  truncate,
} from "../lib/format";
import { Badge, Card, DataState, SectionHeader, Table } from "../ui";
import { FilterBar } from "../components/FilterBar";

const SPAN_STATUSES = [
  { value: "success", label: "Success" },
  { value: "running", label: "Running" },
  { value: "error", label: "Error" },
];

export function TracesPage() {
  const traces = useQuery(api.dashboard.listRecentTraces, { limit: 200 });
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);

  const rows = useMemo(
    () =>
      traces
        ? filterList(
            traces,
            filter,
            (t) => [t.operationName, t.traceId, t.agentName, t.model],
            (t) => t.status,
          )
        : [],
    [traces, filter],
  );

  return (
    <div>
      <SectionHeader eyebrow="Tracing" title="Traces" />
      <FilterBar
        value={filter}
        onChange={setFilter}
        statuses={SPAN_STATUSES}
        placeholder="Search operation or trace id…"
      />
      <Card>
        <DataState
          data={traces}
          loadingLabel="Loading traces"
          emptyIcon={<Activity size={28} />}
          emptyTitle="No traces yet"
          emptyHint="Record a span through the evalbench client and it appears here live."
        >
          {() =>
            rows.length === 0 ? (
              <p className="text-[13px] text-[var(--color-soft)] px-4 py-8 text-center">
                No traces match the filter.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Model</th>
                    <th className="text-right">Tokens</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const tone = spanStatusTone(t.status);
                    return (
                      <tr key={t._id}>
                        <td>
                          <Link
                            to={`/traces/${encodeURIComponent(t.traceId)}`}
                            className="font-mono text-[13px] text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                          >
                            {truncate(t.operationName, 48)}
                          </Link>
                        </td>
                        <td>
                          <span className="pill pill-muted">{t.kind}</span>
                        </td>
                        <td>
                          <Badge tone={tone.tone} live={tone.live}>
                            {t.status}
                          </Badge>
                        </td>
                        <td className="text-[12px] text-[var(--color-muted)]">
                          {t.model ?? "—"}
                        </td>
                        <td className="text-right font-mono text-[12px]">
                          {formatTokens(t.totalTokens)}
                        </td>
                        <td className="text-right font-mono text-[12px]">
                          {formatCost(t.costUsd)}
                        </td>
                        <td className="text-right text-[12px] text-[var(--color-soft)] whitespace-nowrap">
                          {formatTime(t.startedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )
          }
        </DataState>
      </Card>
    </div>
  );
}

export function TraceDetailPage() {
  const { traceId = "" } = useParams();
  const spans = useQuery(api.dashboard.spansByTrace, { traceId });

  const tree = useMemo(
    () => (spans ? buildSpanTree(spans) : null),
    [spans],
  );

  const rootRollup = useMemo(() => {
    if (!tree) return { totalTokens: 0, costUsd: 0 };
    return tree.roots.reduce(
      (acc, n) => ({
        totalTokens: acc.totalTokens + n.rollup.totalTokens,
        costUsd: acc.costUsd + n.rollup.costUsd,
      }),
      { totalTokens: 0, costUsd: 0 },
    );
  }, [tree]);

  return (
    <div>
      <Link
        to="/traces"
        className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-soft)] hover:text-[var(--color-ink)] mb-3"
      >
        <ArrowLeft size={13} /> Traces
      </Link>
      <SectionHeader
        eyebrow="Trace"
        title={<span className="font-mono text-[20px]">{truncate(traceId, 28)}</span>}
        actions={
          spans && spans.length > 0 ? (
            <div className="flex items-center gap-4 text-[12px] text-[var(--color-muted)] font-mono">
              <span>{spans.length} spans</span>
              <span>{formatTokens(rootRollup.totalTokens)} tok</span>
              <span>{formatCost(rootRollup.costUsd)}</span>
            </div>
          ) : undefined
        }
      />
      <Card className="p-2">
        <DataState
          data={spans}
          loadingLabel="Loading span tree"
          emptyIcon={<Activity size={28} />}
          emptyTitle="No spans for this trace"
          emptyHint="Spans appear here live as they are recorded."
        >
          {(loaded) => <SpanTreeView spans={loaded} />}
        </DataState>
      </Card>
    </div>
  );
}

function SpanTreeView({ spans }: { spans: Span[] }) {
  const tree = useMemo(() => buildSpanTree(spans), [spans]);
  const flat = useMemo(() => flattenTree(tree), [tree]);
  return (
    <div className="flex flex-col">
      {flat.map((node) => (
        <SpanRow
          key={node.span._id}
          node={node}
          maxLatency={tree.maxLatency}
        />
      ))}
    </div>
  );
}

function SpanRow({
  node,
  maxLatency,
}: {
  node: SpanNode;
  maxLatency: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { span } = node;
  const tone = spanStatusTone(span.status);
  const hasContent = span.contentRecorded === true;
  const hasChildren = node.children.length > 0;
  const duration = spanDurationMs(span);
  const fraction = durationFraction(duration, maxLatency);

  return (
    <div className="border-b border-[var(--color-rule)] last:border-b-0">
      <div
        className="flex items-center gap-3 px-2 py-2.5 hover:bg-[var(--color-paper-2)] rounded"
        style={{ paddingLeft: `${8 + node.depth * 20}px` }}
      >
        <button
          type="button"
          onClick={() => hasContent && setExpanded((v) => !v)}
          className={`shrink-0 text-[var(--color-soft)] ${hasContent ? "hover:text-[var(--color-ink)]" : "opacity-30 cursor-default"}`}
          aria-label={expanded ? "Collapse content" : "Expand content"}
          disabled={!hasContent}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="pill pill-muted shrink-0">{span.kind}</span>
        <span className="font-mono text-[13px] text-[var(--color-ink)] truncate flex-1 min-w-0">
          {span.operationName}
          {span.model && (
            <span className="text-[var(--color-soft)]"> · {span.model}</span>
          )}
        </span>
        <Badge tone={tone.tone} live={tone.live}>
          {span.status}
        </Badge>
        <div className="w-28 shrink-0 hidden md:block">
          {fraction !== undefined && (
            <div className="h-1.5 rounded-full bg-[var(--color-paper-3)] overflow-hidden">
              <div
                className={`h-full rounded-full ${span.status === "error" ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]"}`}
                style={{ width: `${fraction * 100}%` }}
              />
            </div>
          )}
        </div>
        <div className="w-40 shrink-0 text-right font-mono text-[11px] text-[var(--color-muted)] whitespace-nowrap">
          {formatDuration(duration)}
          {" · "}
          {hasChildren
            ? `Σ${formatTokens(node.rollup.totalTokens)}`
            : formatTokens(span.totalTokens)}
          {(hasChildren ? node.rollup.costUsd : span.costUsd ?? 0) > 0 && (
            <>
              {" · "}
              {formatCost(
                hasChildren ? node.rollup.costUsd : span.costUsd,
              )}
            </>
          )}
        </div>
      </div>
      {expanded && hasContent && (
        <div style={{ paddingLeft: `${34 + node.depth * 20}px` }} className="pr-2 pb-3">
          <SpanContent spanId={span._id} />
        </div>
      )}
    </div>
  );
}

function SpanContent({ spanId }: { spanId: string }) {
  const content = useQuery(api.dashboard.spanContent, { spanId });
  if (content === undefined) {
    return (
      <p className="text-[11px] text-[var(--color-soft)] font-mono">
        Loading content…
      </p>
    );
  }
  const hasAny =
    content.input !== undefined ||
    content.output !== undefined ||
    content.inputUrl != null ||
    content.outputUrl != null;
  if (!hasAny) {
    return (
      <p className="text-[11px] text-[var(--color-soft)] font-mono">
        No content recorded for this span.
      </p>
    );
  }
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <ContentPane label="Input" text={content.input} url={content.inputUrl} />
      <ContentPane
        label="Output"
        text={content.output}
        url={content.outputUrl}
      />
    </div>
  );
}

function ContentPane({
  label,
  text,
  url,
}: {
  label: string;
  text?: string;
  url?: string | null;
}) {
  if (text === undefined && url == null) return null;
  return (
    <div className="card-soft p-3">
      <div className="eyebrow mb-1.5">{label}</div>
      {text !== undefined ? (
        <pre className="text-[11px] font-mono text-[var(--color-ink)] whitespace-pre-wrap break-words max-h-64 overflow-auto">
          {stringifyValue(text)}
        </pre>
      ) : (
        <a
          href={url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-[var(--color-link)] underline"
        >
          Open stored content
        </a>
      )}
    </div>
  );
}
