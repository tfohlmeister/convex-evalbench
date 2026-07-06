import type { DatasetItem, RunResult } from "./types";

export type ScoreRecord = NonNullable<RunResult["scores"]>[number];

export interface JoinedResult {
  result: RunResult;
  item: DatasetItem | undefined;
}

/**
 * Join each result row to its dataset item by `itemId`, so a row can show
 * the item's input and expected output (which live on the item, not the
 * result) next to the produced output.
 */
export function joinResults(
  results: RunResult[],
  items: DatasetItem[],
): JoinedResult[] {
  const byId = new Map(items.map((it) => [it._id, it]));
  return results.map((result) => ({
    result,
    item: byId.get(result.itemId),
  }));
}

/**
 * The distinct scorer names across a run's results, in first-appearance
 * order, so the results table can render one stable column per scorer.
 */
export function scorerNames(results: RunResult[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const result of results) {
    for (const score of result.scores ?? []) {
      if (!seen.has(score.scorer)) {
        seen.add(score.scorer);
        names.push(score.scorer);
      }
    }
  }
  return names;
}

/** One scorer's record on a result, if that scorer ran for the item. */
export function scoreFor(
  result: RunResult,
  scorer: string,
): ScoreRecord | undefined {
  return (result.scores ?? []).find((s) => s.scorer === scorer);
}
