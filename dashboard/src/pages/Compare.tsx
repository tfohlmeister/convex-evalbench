import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { Check, ChevronDown, ChevronRight, GitCompareArrows, X } from "lucide-react";
import { api } from "../lib/convex";
import type { ItemComparison, Run } from "../lib/types";
import { classificationTone } from "../lib/status";
import { summarizeMovement, lineDiff } from "../lib/compare";
import { formatScore, formatScoreDelta, formatTime, stringifyValue } from "../lib/format";
import { Badge, Card, DataState, SectionHeader, Table } from "../ui";

function runLabel(run: Run): string {
  const name = run.targetVersion ?? run._id.slice(0, 8);
  return `${name} · ${run.status} · ${formatTime(run.startedAt)}`;
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const datasetId = params.get("dataset") ?? "";
  const baseline = params.get("baseline") ?? "";
  const candidate = params.get("candidate") ?? "";

  const datasets = useQuery(api.dashboard.listDatasets, {
    includeArchived: true,
  });
  const runs = useQuery(
    api.dashboard.listRuns,
    datasetId ? { datasetId, limit: 200 } : "skip",
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing the dataset invalidates the run selection.
    if (key === "dataset") {
      next.delete("baseline");
      next.delete("candidate");
    }
    setParams(next, { replace: true });
  };

  return (
    <div>
      <SectionHeader eyebrow="Regression" title="Compare" />

      <Card className="p-4 mb-6">
        <div className="grid md:grid-cols-3 gap-4">
          <Picker label="Dataset">
            <select
              className="input"
              value={datasetId}
              onChange={(e) => setParam("dataset", e.target.value)}
            >
              <option value="">Select a dataset…</option>
              {(datasets ?? []).map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name} v{d.version}
                </option>
              ))}
            </select>
          </Picker>
          <Picker label="Baseline run">
            <select
              className="input"
              value={baseline}
              disabled={!datasetId}
              onChange={(e) => setParam("baseline", e.target.value)}
            >
              <option value="">Select baseline…</option>
              {(runs ?? []).map((r) => (
                <option key={r._id} value={r._id}>
                  {runLabel(r)}
                </option>
              ))}
            </select>
          </Picker>
          <Picker label="Candidate run">
            <select
              className="input"
              value={candidate}
              disabled={!datasetId}
              onChange={(e) => setParam("candidate", e.target.value)}
            >
              <option value="">Select candidate…</option>
              {(runs ?? []).map((r) => (
                <option key={r._id} value={r._id}>
                  {runLabel(r)}
                </option>
              ))}
            </select>
          </Picker>
        </div>
      </Card>

      {baseline && candidate ? (
        <ComparisonView
          datasetId={datasetId}
          baseline={baseline}
          candidate={candidate}
        />
      ) : (
        <Card>
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="text-[var(--color-soft)] mb-3">
              <GitCompareArrows size={28} />
            </div>
            <p className="font-serif text-[20px]">Pick two runs to compare</p>
            <p className="text-[13px] text-[var(--color-soft)] mt-1.5 max-w-sm">
              Choose a dataset, then a baseline and a candidate run over it. The
              comparison is encoded in the URL so it is shareable.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function Picker({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function ComparisonView({
  datasetId,
  baseline,
  candidate,
}: {
  datasetId: string;
  baseline: string;
  candidate: string;
}) {
  const comparison = useQuery(api.dashboard.compareRuns, {
    baselineRunId: baseline,
    candidateRunId: candidate,
  });
  const gate = useQuery(api.dashboard.evaluateGate, {
    baselineRunId: baseline,
    candidateRunId: candidate,
  });

  // Outputs and inputs for the on-demand per-item diff.
  const baselineResults = useQuery(api.dashboard.listResults, {
    runId: baseline,
  });
  const candidateResults = useQuery(api.dashboard.listResults, {
    runId: candidate,
  });
  const items = useQuery(
    api.dashboard.listItems,
    datasetId ? { datasetId } : "skip",
  );

  const baselineOut = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const r of baselineResults ?? []) m.set(r.itemId, r.output);
    return m;
  }, [baselineResults]);
  const candidateOut = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const r of candidateResults ?? []) m.set(r.itemId, r.output);
    return m;
  }, [candidateResults]);
  const inputById = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const it of items ?? []) m.set(it._id, it.input);
    return m;
  }, [items]);

  return (
    <div>
      {gate && (
        <div
          className={`card border-t-4 p-4 mb-4 flex items-center gap-3 ${gate.ok ? "border-t-[var(--color-ok)]" : "border-t-[var(--color-danger)]"}`}
        >
          <span
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${gate.ok ? "bg-[var(--color-ok-tint)] text-[var(--color-ok)]" : "bg-[var(--color-danger-tint)] text-[var(--color-danger)]"}`}
          >
            {gate.ok ? <Check size={18} /> : <X size={18} />}
          </span>
          <div>
            <div className="font-serif text-[18px]">
              Gate {gate.ok ? "passed" : "failed"}
            </div>
            {!gate.ok && gate.reasons.length > 0 && (
              <div className="text-[12px] text-[var(--color-danger)] font-mono mt-0.5">
                {gate.reasons.join(" · ")}
              </div>
            )}
          </div>
        </div>
      )}

      <DataState
        data={comparison}
        loadingLabel="Computing comparison"
        emptyTitle="No comparison"
      >
        {(cmp) => {
          const m = summarizeMovement(cmp.stats);
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <MovementCard label="Regressed" value={m.regressed} tone="danger" />
                <MovementCard label="Improved" value={m.improved} tone="ok" />
                <MovementCard label="Unchanged" value={m.unchanged} tone="muted" />
                <MovementCard
                  label="Incomplete"
                  value={m.incomplete}
                  tone="warn"
                />
                <div className="card-soft p-3">
                  <div className="eyebrow mb-1">Mean score</div>
                  <div className="font-mono text-[15px]">
                    {formatScore(m.baselineMean)} → {formatScore(m.candidateMean)}
                  </div>
                  <div
                    className={`text-[12px] font-mono ${m.meanDelta < 0 ? "text-[var(--color-danger)]" : m.meanDelta > 0 ? "text-[var(--color-ok)]" : "text-[var(--color-soft)]"}`}
                  >
                    {formatScoreDelta(m.meanDelta)}
                  </div>
                </div>
              </div>

              <Card>
                <Table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Classification</th>
                      <th className="text-right">Baseline</th>
                      <th className="text-right">Candidate</th>
                      <th className="text-right">Δ</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmp.items.map((item) => (
                      <CompareRow
                        key={item.itemId}
                        item={item}
                        input={inputById.get(item.itemId)}
                        baselineOutput={baselineOut.get(item.itemId)}
                        candidateOutput={candidateOut.get(item.itemId)}
                      />
                    ))}
                  </tbody>
                </Table>
              </Card>
            </>
          );
        }}
      </DataState>
    </div>
  );
}

function MovementCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "ok" | "muted" | "warn";
}) {
  const color = {
    danger: "text-[var(--color-danger)]",
    ok: "text-[var(--color-ok)]",
    muted: "text-[var(--color-muted)]",
    warn: "text-[var(--color-warn)]",
  }[tone];
  return (
    <div className="card-soft p-3">
      <div className="eyebrow mb-1">{label}</div>
      <div className={`font-mono text-[22px] ${color}`}>{value}</div>
    </div>
  );
}

function CompareRow({
  item,
  input,
  baselineOutput,
  candidateOutput,
}: {
  item: ItemComparison;
  input: unknown;
  baselineOutput: unknown;
  candidateOutput: unknown;
}) {
  const [open, setOpen] = useState(false);
  const canDiff =
    baselineOutput !== undefined || candidateOutput !== undefined;
  return (
    <>
      <tr>
        <td className="font-mono text-[11px] text-[var(--color-muted)]">
          {input !== undefined ? (
            <span className="text-[var(--color-ink)]">
              {stringifyValue(input).slice(0, 32)}
            </span>
          ) : (
            item.itemId.slice(0, 10)
          )}
        </td>
        <td>
          <Badge tone={classificationTone(item.classification)}>
            {item.classification}
          </Badge>
        </td>
        <td className="text-right font-mono text-[12px]">
          {formatScore(item.baselineScore)}
        </td>
        <td className="text-right font-mono text-[12px]">
          {formatScore(item.candidateScore)}
        </td>
        <td
          className={`text-right font-mono text-[12px] ${item.scoreDelta !== undefined && item.scoreDelta < 0 ? "text-[var(--color-danger)]" : item.scoreDelta !== undefined && item.scoreDelta > 0 ? "text-[var(--color-ok)]" : ""}`}
        >
          {formatScoreDelta(item.scoreDelta)}
        </td>
        <td>
          {canDiff && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--color-soft)] hover:text-[var(--color-ink)]"
              aria-label={open ? "Hide diff" : "Show diff"}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              diff
            </button>
          )}
        </td>
      </tr>
      {open && canDiff && (
        <tr>
          <td colSpan={6} className="bg-[var(--color-paper-2)]">
            <OutputDiff
              baseline={stringifyValue(baselineOutput)}
              candidate={stringifyValue(candidateOutput)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function OutputDiff({
  baseline,
  candidate,
}: {
  baseline: string;
  candidate: string;
}) {
  const diff = useMemo(() => lineDiff(baseline, candidate), [baseline, candidate]);
  return (
    <div className="grid md:grid-cols-2 gap-3 p-2">
      <DiffPane label="Baseline output" lines={diff.baseline} tone="danger" />
      <DiffPane label="Candidate output" lines={diff.candidate} tone="ok" />
    </div>
  );
}

function DiffPane({
  label,
  lines,
  tone,
}: {
  label: string;
  lines: { text: string; changed: boolean }[];
  tone: "danger" | "ok";
}) {
  const changedBg =
    tone === "danger"
      ? "bg-[var(--color-danger-tint)]"
      : "bg-[var(--color-ok-tint)]";
  return (
    <div className="card p-3">
      <div className="eyebrow mb-1.5">{label}</div>
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words">
        {lines.length === 0 ? (
          <span className="text-[var(--color-soft)]">—</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={line.changed ? changedBg : ""}>
              {line.text || " "}
            </div>
          ))
        )}
      </pre>
    </div>
  );
}
