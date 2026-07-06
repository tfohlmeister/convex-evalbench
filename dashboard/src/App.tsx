import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import {
  Activity,
  Database,
  GitCompareArrows,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { QueryErrorBoundary } from "./ui";
import { TracesPage, TraceDetailPage } from "./pages/Traces";
import { RunsPage, RunDetailPage } from "./pages/Runs";
import { DatasetsPage, DatasetDetailPage } from "./pages/Datasets";
import { ComparePage } from "./pages/Compare";

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/traces", label: "Traces", icon: Activity },
  { to: "/runs", label: "Runs", icon: ListChecks },
  { to: "/datasets", label: "Datasets", icon: Database },
  { to: "/compare", label: "Compare", icon: GitCompareArrows },
];

export function App() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside
        className="
          md:w-56 md:shrink-0 md:min-h-screen
          md:border-r border-b md:border-b-0 border-[var(--color-rule)]
          bg-[var(--color-paper)]/70 backdrop-blur-sm
          px-5 py-6 flex md:flex-col items-center md:items-stretch gap-6
        "
      >
        <Brand />
        <nav className="flex md:flex-col gap-1 flex-1">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="hidden md:block text-[10px] text-[var(--color-soft)] font-mono leading-relaxed">
          <div className="mb-1 tracking-[0.18em] uppercase">Live</div>
          <div className="opacity-70">Reactive eval, tracing & regression</div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-6 md:px-10 py-8 md:py-10">
        <div className="max-w-[1400px] mx-auto">
          <QueryErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/traces" replace />} />
              <Route path="/traces" element={<TracesPage />} />
              <Route path="/traces/:traceId" element={<TraceDetailPage />} />
              <Route path="/runs" element={<RunsPage />} />
              <Route path="/runs/:runId" element={<RunDetailPage />} />
              <Route path="/datasets" element={<DatasetsPage />} />
              <Route
                path="/datasets/:datasetId"
                element={<DatasetDetailPage />}
              />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="*" element={<Navigate to="/traces" replace />} />
            </Routes>
          </QueryErrorBoundary>
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-accent)]"
      />
      <span className="font-serif text-[22px] leading-none tracking-tight text-[var(--color-ink)]">
        <span className="italic">eval</span>
        <span>bench</span>
      </span>
    </div>
  );
}

function NavItem({ to, label, icon: Icon }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex items-center gap-2.5 px-3 py-2 rounded-md font-mono text-[11px] tracking-[0.14em] uppercase transition-colors ${
          isActive
            ? "text-[var(--color-ink)] bg-[var(--color-paper-2)]"
            : "text-[var(--color-soft)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper-2)]/60"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-[var(--color-accent)] rounded-r"
            />
          )}
          <Icon size={14} aria-hidden />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}
