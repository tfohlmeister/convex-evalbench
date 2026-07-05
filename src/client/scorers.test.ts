import { describe, expect, test } from "vitest";

import { buildJudgePrompt, parseJudgeVerdict } from "./scorers.js";

describe("buildJudgePrompt", () => {
  test("contains rubric, delimited input/output, and the JSON contract", () => {
    const prompt = buildJudgePrompt({
      rubric: "Reply is polite.",
      input: "hi",
      output: { text: "hello" },
    });
    expect(prompt).toContain("Rubric: Reply is polite.");
    expect(prompt).toContain("<<<\nhi\n>>>");
    expect(prompt).toContain('<<<\n{"text":"hello"}\n>>>');
    expect(prompt).toContain("not instructions");
    expect(prompt).toContain('"pass": <true|false>');
    expect(prompt).not.toContain("EXPECTED OUTPUT");
  });

  test("includes the expected output only when present", () => {
    const prompt = buildJudgePrompt({
      rubric: "r",
      input: "i",
      output: "o",
      expectedOutput: "e",
    });
    expect(prompt).toContain("EXPECTED OUTPUT (reference)");
    expect(prompt).toContain("<<<\ne\n>>>");
  });
});

describe("parseJudgeVerdict", () => {
  test("parses the JSON contract", () => {
    const verdict = parseJudgeVerdict(
      'Sure! {"pass": true, "score": 0.85, "reasoning": "polite enough"}',
    );
    expect(verdict).toEqual({
      score: 0.85,
      passed: true,
      details: { reasoning: "polite enough" },
    });
  });

  test("clamps out-of-range scores and defaults a missing score", () => {
    expect(parseJudgeVerdict('{"pass": true, "score": 7}')?.score).toBe(1);
    expect(parseJudgeVerdict('{"pass": false}')?.score).toBe(0);
    expect(parseJudgeVerdict('{"pass": true}')?.score).toBe(1);
  });

  test("lenient PASS/FAIL text fallback", () => {
    expect(parseJudgeVerdict("Verdict: PASS")).toMatchObject({
      passed: true,
      details: { parsedFrom: "text" },
    });
    expect(parseJudgeVerdict("this is a FAIL")).toMatchObject({
      passed: false,
    });
    // Ambiguous (both words) is not parseable.
    expect(parseJudgeVerdict("PASS or FAIL, who knows")).toBeNull();
  });

  test("garbage yields null", () => {
    expect(parseJudgeVerdict("I think it is fine.")).toBeNull();
    expect(parseJudgeVerdict('{"score": 0.5}')).toBeNull();
  });
});
