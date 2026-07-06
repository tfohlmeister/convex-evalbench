import type { FunctionReturnType } from "convex/server";
import { api } from "./convex";

// Precise view types derived from the host wrapper return types, so the
// views stay in lockstep with the backend contract without re-declaring
// any shapes.

export type Span = FunctionReturnType<
  typeof api.dashboard.spansByTrace
>[number];

export type Dataset = FunctionReturnType<
  typeof api.dashboard.listDatasets
>[number];

export type DatasetItem = FunctionReturnType<
  typeof api.dashboard.listItems
>[number];

export type Run = FunctionReturnType<typeof api.dashboard.listAllRuns>[number];

export type RunResult = FunctionReturnType<
  typeof api.dashboard.listResults
>[number];

export type Comparison = FunctionReturnType<typeof api.dashboard.compareRuns>;
export type ItemComparison = Comparison["items"][number];

export type Gate = FunctionReturnType<typeof api.dashboard.evaluateGate>;

export type SpanContent = FunctionReturnType<
  typeof api.dashboard.spanContent
>;
