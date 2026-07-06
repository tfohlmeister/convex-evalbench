import { describe, expect, it } from "vitest";
import {
  classificationTone,
  resultStatusTone,
  runStatusTone,
  spanStatusTone,
} from "./status";

describe("classificationTone", () => {
  it("maps each classification to a badge tone", () => {
    expect(classificationTone("improved")).toBe("ok");
    expect(classificationTone("regressed")).toBe("danger");
    expect(classificationTone("unchanged")).toBe("muted");
    expect(classificationTone("incomplete")).toBe("warn");
  });
});

describe("status tones", () => {
  it("marks in-progress run states as live", () => {
    expect(runStatusTone("running")).toEqual({ tone: "info", live: true });
    expect(runStatusTone("completed")).toEqual({ tone: "ok", live: false });
  });

  it("marks pending/running results as live", () => {
    expect(resultStatusTone("pending").live).toBe(true);
    expect(resultStatusTone("success")).toEqual({ tone: "ok", live: false });
    expect(resultStatusTone("error").tone).toBe("danger");
  });

  it("maps span statuses", () => {
    expect(spanStatusTone("error").tone).toBe("danger");
    expect(spanStatusTone("running").live).toBe(true);
  });
});
