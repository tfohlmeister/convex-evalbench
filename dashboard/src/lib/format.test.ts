import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatDuration,
  formatScore,
  formatScoreDelta,
  formatTokens,
  stringifyValue,
  truncate,
} from "./format";

describe("format helpers", () => {
  it("formats tokens compactly", () => {
    expect(formatTokens(undefined)).toBe("—");
    expect(formatTokens(30)).toBe("30");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(15000)).toBe("15k");
  });

  it("formats cost with adaptive precision", () => {
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.0012)).toBe("$0.0012");
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("formats duration in ms/s/m", () => {
    expect(formatDuration(340)).toBe("340ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(65000)).toBe("1m 05s");
  });

  it("formats scores and signed deltas as percentage points", () => {
    expect(formatScore(0.92)).toBe("92%");
    expect(formatScore(undefined)).toBe("—");
    expect(formatScoreDelta(0.08)).toBe("+8pp");
    expect(formatScoreDelta(-0.33)).toBe("−33pp");
    expect(formatScoreDelta(0)).toBe("±0pp");
  });

  it("stringifies values and truncates", () => {
    expect(stringifyValue("hi")).toBe("hi");
    expect(stringifyValue({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(truncate("abcdef", 4)).toBe("abc…");
  });
});
