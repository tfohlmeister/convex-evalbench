import { describe, expect, it } from "vitest";
import type { Span } from "./types";
import {
  buildSpanTree,
  durationFraction,
  flattenTree,
  spanDurationMs,
} from "./spanTree";

function span(partial: Partial<Span> & { spanId: string }): Span {
  return {
    _id: partial.spanId,
    _creationTime: 0,
    traceId: "t",
    kind: "llm",
    operationName: partial.spanId,
    status: "success",
    startedAt: 0,
    ...partial,
  } as unknown as Span;
}

describe("buildSpanTree", () => {
  it("nests children under parents by parentSpanId", () => {
    const tree = buildSpanTree([
      span({ spanId: "root" }),
      span({ spanId: "child", parentSpanId: "root" }),
    ]);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].children.map((c) => c.span.spanId)).toEqual([
      "child",
    ]);
  });

  it("rolls up tokens and cost onto ancestors", () => {
    const tree = buildSpanTree([
      span({ spanId: "root" }),
      span({ spanId: "a", parentSpanId: "root", totalTokens: 30, costUsd: 0.01 }),
      span({ spanId: "b", parentSpanId: "root", totalTokens: 20, costUsd: 0.02 }),
    ]);
    expect(tree.roots[0].rollup.totalTokens).toBe(50);
    expect(tree.roots[0].rollup.costUsd).toBeCloseTo(0.03);
  });

  it("falls back to input+output tokens when totalTokens is absent", () => {
    const tree = buildSpanTree([
      span({ spanId: "root", inputTokens: 10, outputTokens: 5 }),
    ]);
    expect(tree.roots[0].rollup.totalTokens).toBe(15);
  });

  it("treats an orphan (missing parent) as a root, dropping nothing", () => {
    const tree = buildSpanTree([
      span({ spanId: "orphan", parentSpanId: "not-here" }),
    ]);
    expect(tree.roots.map((r) => r.span.spanId)).toEqual(["orphan"]);
  });

  it("orders siblings by startedAt and reports max duration", () => {
    const tree = buildSpanTree([
      span({ spanId: "late", startedAt: 100, latencyMs: 40 }),
      span({ spanId: "early", startedAt: 10, latencyMs: 200 }),
    ]);
    expect(flattenTree(tree).map((n) => n.span.spanId)).toEqual([
      "early",
      "late",
    ]);
    expect(tree.maxLatency).toBe(200);
  });
});

describe("spanDurationMs", () => {
  it("prefers recorded latencyMs", () => {
    expect(spanDurationMs(span({ spanId: "s", latencyMs: 42, startedAt: 0, endedAt: 999 }))).toBe(42);
  });
  it("derives from endedAt - startedAt when latency is unset", () => {
    expect(spanDurationMs(span({ spanId: "s", startedAt: 100, endedAt: 160 }))).toBe(60);
  });
  it("is undefined for an unfinished span", () => {
    expect(spanDurationMs(span({ spanId: "s", startedAt: 100 }))).toBeUndefined();
  });
});

describe("durationFraction", () => {
  it("scales latency against the max, with a visible minimum", () => {
    expect(durationFraction(100, 200)).toBeCloseTo(0.5);
    expect(durationFraction(1, 1000)).toBe(0.02);
  });
  it("is undefined without a usable latency or max", () => {
    expect(durationFraction(undefined, 100)).toBeUndefined();
    expect(durationFraction(50, 0)).toBeUndefined();
  });
});
