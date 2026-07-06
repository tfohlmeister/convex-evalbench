import type { Span } from "./types";

export interface SpanNode {
  span: Span;
  children: SpanNode[];
  depth: number;
  /** Aggregated metrics over this span's whole subtree (incl. itself). */
  rollup: { totalTokens: number; costUsd: number };
}

export interface SpanTree {
  roots: SpanNode[];
  /** Largest single-span latency, for scaling duration bars. */
  maxLatency: number;
}

/** A span's own total tokens, falling back to input+output when unset. */
function ownTokens(span: Span): number {
  if (span.totalTokens !== undefined) return span.totalTokens;
  return (span.inputTokens ?? 0) + (span.outputTokens ?? 0);
}

/**
 * A span's duration: the recorded `latencyMs` when present, else derived
 * from `endedAt - startedAt` (a span that only carries timestamps still
 * gets a meaningful duration bar). Undefined while a span is unfinished.
 */
export function spanDurationMs(span: Span): number | undefined {
  if (span.latencyMs !== undefined) return span.latencyMs;
  if (span.endedAt !== undefined) return Math.max(0, span.endedAt - span.startedAt);
  return undefined;
}

/**
 * Assemble spans into a forest by `parentSpanId`, oldest first, and
 * aggregate tokens/cost onto every ancestor. A span whose parent is not
 * in the set (an orphan, e.g. the parent not yet recorded) is treated as
 * a root, so nothing is dropped from a live-filling tree.
 */
export function buildSpanTree(spans: Span[]): SpanTree {
  const nodes = new Map<string, SpanNode>();
  for (const span of spans) {
    nodes.set(span.spanId, {
      span,
      children: [],
      depth: 0,
      rollup: { totalTokens: 0, costUsd: 0 },
    });
  }

  const roots: SpanNode[] = [];
  for (const span of spans) {
    const node = nodes.get(span.spanId)!;
    const parent =
      span.parentSpanId !== undefined
        ? nodes.get(span.parentSpanId)
        : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byStart = (a: SpanNode, b: SpanNode) =>
    a.span.startedAt - b.span.startedAt;
  roots.sort(byStart);

  let maxLatency = 0;
  const visit = (node: SpanNode, depth: number): void => {
    node.depth = depth;
    node.children.sort(byStart);
    node.rollup.totalTokens = ownTokens(node.span);
    node.rollup.costUsd = node.span.costUsd ?? 0;
    const duration = spanDurationMs(node.span);
    if (duration !== undefined) {
      maxLatency = Math.max(maxLatency, duration);
    }
    for (const child of node.children) {
      visit(child, depth + 1);
      node.rollup.totalTokens += child.rollup.totalTokens;
      node.rollup.costUsd += child.rollup.costUsd;
    }
  };
  for (const root of roots) visit(root, 0);

  return { roots, maxLatency };
}

/** Flatten the forest depth-first into render order. */
export function flattenTree(tree: SpanTree): SpanNode[] {
  const out: SpanNode[] = [];
  const walk = (node: SpanNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of tree.roots) walk(root);
  return out;
}

/**
 * Fraction (0..1) of the widest span's latency, for a duration bar. A
 * recorded-but-tiny latency still gets a visible sliver (min 0.02).
 */
export function durationFraction(
  latencyMs: number | undefined,
  maxLatency: number,
): number | undefined {
  if (latencyMs === undefined) return undefined;
  if (maxLatency <= 0) return undefined;
  return Math.max(0.02, latencyMs / maxLatency);
}
