import { describe, expect, it } from "vitest";
import { parseItems } from "./datasetInput";

describe("parseItems", () => {
  it("treats empty input as no items", () => {
    expect(parseItems("   ")).toEqual({ items: [], error: null });
  });

  it("parses a JSON array of items", () => {
    const out = parseItems(
      '[{"input":"hello","expectedOutput":"HELLO"},{"input":"x"}]',
    );
    expect(out.error).toBeNull();
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toEqual({ input: "hello", expectedOutput: "HELLO" });
  });

  it("rejects invalid JSON", () => {
    expect(parseItems("{not json").error).toBe("Items must be valid JSON.");
  });

  it("rejects a non-array JSON value", () => {
    expect(parseItems('{"input":"x"}').error).toBe(
      "Items must be a JSON array.",
    );
  });

  it("rejects an element missing an input field", () => {
    expect(parseItems('[{"expectedOutput":"X"}]').error).toBe(
      "Each item needs an `input` field.",
    );
    expect(parseItems("[null]").error).toBe(
      "Each item needs an `input` field.",
    );
  });
});
