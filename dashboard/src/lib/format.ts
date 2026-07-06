/** Compact token count: 1234 -> "1.2k", small values as-is. */
export function formatTokens(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

/** USD cost to a sensible precision, e.g. "$0.0123", "$1.20". */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Latency in ms as "340ms" / "1.2s" / "1m 05s". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** A 0..1 score as a percentage, e.g. "92%"; blank for undefined. */
export function formatScore(score: number | undefined): string {
  if (score === undefined) return "—";
  return `${Math.round(score * 100)}%`;
}

/** A signed score delta as percentage points, e.g. "+8pp", "−12pp". */
export function formatScoreDelta(delta: number | undefined): string {
  if (delta === undefined) return "—";
  const pp = Math.round(delta * 100);
  if (pp === 0) return "±0pp";
  const sign = pp > 0 ? "+" : "−";
  return `${sign}${Math.abs(pp)}pp`;
}

/** Wall-clock time of a millisecond timestamp, local short form. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Truncate a string to `n` chars with an ellipsis. */
export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Render an arbitrary stored value (dataset input, produced output) as a
 * display string: strings pass through, everything else is pretty JSON.
 */
export function stringifyValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
