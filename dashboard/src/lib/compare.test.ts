import { describe, expect, it } from "vitest";
import type { Comparison } from "./types";
import { lineDiff, summarizeMovement } from "./compare";

function stats(partial: Partial<Comparison["stats"]>): Comparison["stats"] {
  return {
    total: 0,
    regressed: 0,
    improved: 0,
    unchanged: 0,
    incomplete: 0,
    baselineTerminal: 0,
    candidateTerminal: 0,
    baselinePassed: 0,
    candidatePassed: 0,
    baselineMeanScore: 0,
    candidateMeanScore: 0,
    ...partial,
  };
}

describe("summarizeMovement", () => {
  it("computes the mean-score delta (candidate minus baseline)", () => {
    const m = summarizeMovement(
      stats({ baselineMeanScore: 0.67, candidateMeanScore: 0.33 }),
    );
    expect(m.meanDelta).toBeCloseTo(-0.34);
  });

  it("passes the classification counts through", () => {
    const m = summarizeMovement(
      stats({ regressed: 1, improved: 2, unchanged: 3, incomplete: 4 }),
    );
    expect([m.regressed, m.improved, m.unchanged, m.incomplete]).toEqual([
      1, 2, 3, 4,
    ]);
  });
});

describe("lineDiff", () => {
  it("marks differing lines as changed on both sides", () => {
    const d = lineDiff("WORLD", "world");
    expect(d.baseline).toEqual([{ text: "WORLD", changed: true }]);
    expect(d.candidate).toEqual([{ text: "world", changed: true }]);
  });

  it("leaves identical lines unchanged", () => {
    const d = lineDiff("same\nx", "same\ny");
    expect(d.baseline[0].changed).toBe(false);
    expect(d.baseline[1].changed).toBe(true);
  });

  it("handles a side with extra lines", () => {
    const d = lineDiff("a", "a\nb");
    expect(d.candidate[1]).toEqual({ text: "b", changed: true });
  });
});
