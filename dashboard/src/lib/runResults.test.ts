import { describe, expect, it } from "vitest";
import type { DatasetItem, RunResult } from "./types";
import { joinResults, scoreFor, scorerNames } from "./runResults";

function result(partial: Partial<RunResult> & { _id: string }): RunResult {
  return {
    _creationTime: 0,
    runId: "run",
    itemId: "item",
    status: "success",
    attempts: 1,
    ...partial,
  } as unknown as RunResult;
}

function item(partial: Partial<DatasetItem> & { _id: string }): DatasetItem {
  return {
    _creationTime: 0,
    datasetId: "ds",
    input: partial.input ?? "x",
    ...partial,
  } as unknown as DatasetItem;
}

describe("scorerNames", () => {
  it("collects distinct scorer names in first-appearance order", () => {
    const results = [
      result({
        _id: "a",
        scores: [
          { scorer: "exactMatch", score: 1, passed: true },
          { scorer: "panel", score: 0.5, passed: false },
        ],
      }),
      result({
        _id: "b",
        scores: [
          { scorer: "panel", score: 1, passed: true },
          { scorer: "embed", score: 1, passed: true },
        ],
      }),
    ];
    expect(scorerNames(results)).toEqual(["exactMatch", "panel", "embed"]);
  });

  it("returns an empty list when no scores are present", () => {
    expect(scorerNames([result({ _id: "a" })])).toEqual([]);
  });
});

describe("joinResults", () => {
  it("joins each result to its dataset item by itemId", () => {
    const joined = joinResults(
      [result({ _id: "r1", itemId: "i1" as RunResult["itemId"] })],
      [item({ _id: "i1", input: "hello" })],
    );
    expect(joined[0].item?.input).toBe("hello");
  });

  it("leaves item undefined when no matching item exists", () => {
    const joined = joinResults(
      [result({ _id: "r1", itemId: "missing" as RunResult["itemId"] })],
      [],
    );
    expect(joined[0].item).toBeUndefined();
  });
});

describe("scoreFor", () => {
  it("finds a scorer's record on a result", () => {
    const r = result({
      _id: "a",
      scores: [{ scorer: "exactMatch", score: 1, passed: true }],
    });
    expect(scoreFor(r, "exactMatch")?.score).toBe(1);
    expect(scoreFor(r, "missing")).toBeUndefined();
  });
});
