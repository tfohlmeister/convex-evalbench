import { describe, expect, it } from "vitest";

import { EVALBENCH_VERSION, isNonEmptyString } from "./shared.js";

describe("shared", () => {
  it("exposes a version string", () => {
    expect(typeof EVALBENCH_VERSION).toBe("string");
  });

  it("detects non-empty strings", () => {
    expect(isNonEmptyString(" x ")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString("")).toBe(false);
  });
});
