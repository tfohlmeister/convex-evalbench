import { describe, expect, test } from "vitest";

import {
  embeddingInputsInvalid,
  embeddingSimilarity,
  exactMatch,
  jsonSchema,
} from "./scorers.js";

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

describe("embeddingSimilarity", () => {
  test("identical vectors score 1 and pass", () => {
    const verdict = embeddingSimilarity([1, 2, 3], [1, 2, 3], 0.8);
    expect(verdict.score).toBeCloseTo(1);
    expect(verdict.passed).toBe(true);
  });

  test("orthogonal vectors score 0 and fail", () => {
    const verdict = embeddingSimilarity([1, 0], [0, 1], 0.8);
    expect(verdict.score).toBe(0);
    expect(verdict.passed).toBe(false);
  });

  test("non-finite vector values fail instead of poisoning the score", () => {
    const verdict = embeddingSimilarity([NaN, 0], [1, 0], 0.8);
    expect(verdict.score).toBe(0);
    expect(verdict.passed).toBe(false);
    expect((verdict.details as { reason: string }).reason).toMatch(
      /non-finite/,
    );
  });

  test("mismatched dimensions fail with a reason", () => {
    const verdict = embeddingSimilarity([1, 2], [1, 2, 3], 0.8);
    expect(verdict.passed).toBe(false);
    expect((verdict.details as { reason: string }).reason).toMatch(
      /mismatched/,
    );
  });

  test("input guard rejects non-strings and missing expectedOutput", () => {
    expect(embeddingInputsInvalid("a", "b")).toBeNull();
    const missing = embeddingInputsInvalid("a", undefined);
    expect(missing?.passed).toBe(false);
    expect((missing?.details as { reason: string }).reason).toMatch(
      /no expectedOutput/,
    );
    const nonString = embeddingInputsInvalid({ a: 1 }, "b");
    expect(nonString?.passed).toBe(false);
  });
});
