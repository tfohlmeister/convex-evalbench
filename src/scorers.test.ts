import { describe, expect, test } from "vitest";

import { exactMatch, jsonSchema } from "./scorers.js";

describe("exactMatch", () => {
  test("passes on an equal output", () => {
    expect(exactMatch({ output: "hello", expectedOutput: "hello" })).toEqual({
      score: 1,
      passed: true,
    });
  });

  test("passes on deep-equal structures regardless of key order", () => {
    const verdict = exactMatch({
      output: { a: 1, b: [1, 2, { c: "x" }] },
      expectedOutput: { b: [1, 2, { c: "x" }], a: 1 },
    });
    expect(verdict.passed).toBe(true);
  });

  test("fails on a differing output", () => {
    const verdict = exactMatch({ output: "hello", expectedOutput: "hi" });
    expect(verdict).toEqual({ score: 0, passed: false });
  });

  test("fails when expectedOutput is absent", () => {
    expect(exactMatch({ output: "hello" }).passed).toBe(false);
  });

  test("compares ArrayBuffer content, not identity", () => {
    const bytes = (values: number[]) => new Uint8Array(values).buffer;
    expect(
      exactMatch({ output: bytes([1, 2, 3]), expectedOutput: bytes([1, 2, 3]) })
        .passed,
    ).toBe(true);
    expect(
      exactMatch({ output: bytes([1, 2, 3]), expectedOutput: bytes([9, 9, 9]) })
        .passed,
    ).toBe(false);
    expect(
      exactMatch({ output: bytes([1, 2]), expectedOutput: bytes([1, 2, 3]) })
        .passed,
    ).toBe(false);
    expect(
      exactMatch({ output: bytes([1]), expectedOutput: { 0: 1 } }).passed,
    ).toBe(false);
  });
});

describe("jsonSchema", () => {
  const schema = {
    type: "object",
    properties: {
      greeting: { type: "string" },
      count: { type: "number" },
    },
    required: ["greeting"],
    additionalProperties: false,
  };

  test("passes on a valid output", () => {
    const verdict = jsonSchema(
      { output: { greeting: "hi", count: 2 } },
      schema,
    );
    expect(verdict).toEqual({ score: 1, passed: true });
  });

  test("fails on an invalid output with error details", () => {
    const verdict = jsonSchema({ output: { count: "two" } }, schema);
    expect(verdict.score).toBe(0);
    expect(verdict.passed).toBe(false);
    const details = verdict.details as { errors: { error: string }[] };
    expect(details.errors.length).toBeGreaterThan(0);
  });
});
