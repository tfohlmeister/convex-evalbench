import type { Comparison } from "./types";

type Stats = Comparison["stats"];

export interface Movement {
  regressed: number;
  improved: number;
  unchanged: number;
  incomplete: number;
  baselineMean: number;
  candidateMean: number;
  /** candidate minus baseline mean score (positive = improvement). */
  meanDelta: number;
}

/**
 * Summarize a comparison's aggregate score movement: the classification
 * counts and the change in mean score from baseline to candidate. Pure,
 * so it is unit-tested directly.
 */
export function summarizeMovement(stats: Stats): Movement {
  return {
    regressed: stats.regressed,
    improved: stats.improved,
    unchanged: stats.unchanged,
    incomplete: stats.incomplete,
    baselineMean: stats.baselineMeanScore,
    candidateMean: stats.candidateMeanScore,
    meanDelta: stats.candidateMeanScore - stats.baselineMeanScore,
  };
}

export interface DiffLine {
  text: string;
  changed: boolean;
}

/**
 * A minimal line-level diff: pair up lines by index and mark a line
 * changed when the two sides differ (or one side is missing that line).
 * Not an LCS diff, but enough to highlight where the candidate output
 * departs from the baseline in a side-by-side view.
 */
export function lineDiff(
  baseline: string,
  candidate: string,
): { baseline: DiffLine[]; candidate: DiffLine[] } {
  const a = baseline.split("\n");
  const b = candidate.split("\n");
  const max = Math.max(a.length, b.length);
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  for (let i = 0; i < max; i++) {
    const la = a[i];
    const lb = b[i];
    const changed = la !== lb;
    if (la !== undefined) left.push({ text: la, changed });
    if (lb !== undefined) right.push({ text: lb, changed });
  }
  return { baseline: left, candidate: right };
}
