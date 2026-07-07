/**
 * Types and pure helpers shared between the client (`src/client`) and the
 * component (`src/component`). Imports are limited to `convex/values`,
 * which is isomorphic (the validator builder runs client- and server-side
 * alike); keep server-only runtime imports out so both sides can use this.
 */

import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

export const EVALBENCH_VERSION = "0.0.0";

/** True when `value` contains at least one non-whitespace character. */
export function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Span classification. A span is one recorded unit of work in a trace:
 * an LLM call, a tool call, an agent step, a workflow step, or a judge
 * verdict. Source-agnostic; no LLM SDK leaks into these names.
 */
export const spanKindValidator = v.union(
  v.literal("llm"),
  v.literal("tool"),
  v.literal("agent_step"),
  v.literal("workflow_step"),
  v.literal("judge"),
);
export type SpanKind = Infer<typeof spanKindValidator>;

/** Lifecycle status of a span. `running` is patched to a terminal state. */
export const spanStatusValidator = v.union(
  v.literal("running"),
  v.literal("success"),
  v.literal("error"),
);
export type SpanStatus = Infer<typeof spanStatusValidator>;

/**
 * Always-recorded span fields: identity/hierarchy, classification,
 * metrics, and status/timing. Recorded for every span regardless of the
 * content-recording opt-in. Spread into the schema table, the public
 * ingestion args, and the internal write seam so the shape stays in one
 * place.
 */
export const spanMetadataFields = {
  // Identity / hierarchy
  traceId: v.string(),
  spanId: v.string(),
  parentSpanId: v.optional(v.string()),
  // Null for production spans; the Phase 2 runner populates it. Kept now
  // to avoid a later schema migration.
  runId: v.optional(v.string()),
  // Classification
  kind: spanKindValidator,
  operationName: v.string(),
  agentName: v.optional(v.string()),
  threadId: v.optional(v.string()),
  userId: v.optional(v.string()),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  // Metrics
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  // Status / timing
  status: spanStatusValidator,
  errorType: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  // Provider extras (e.g. cache token details).
  metadata: v.optional(v.any()),
} as const;

/**
 * Raw span content. Recorded only when the source opts in. Small content
 * (at or below the threshold) is stored inline in these fields; larger
 * content is offloaded to File Storage (see `spanStorageFields`).
 */
export const spanContentFields = {
  input: v.optional(v.string()),
  output: v.optional(v.string()),
} as const;

/**
 * Component-internal content storage fields. Set by the ingestion content
 * path, never supplied by a source. `inputStorageId`/`outputStorageId`
 * hold File Storage objects for content above the inline threshold;
 * `contentRecorded` records whether content recording was on for the span.
 */
export const spanStorageFields = {
  inputStorageId: v.optional(v.id("_storage")),
  outputStorageId: v.optional(v.id("_storage")),
  contentRecorded: v.optional(v.boolean()),
} as const;

/** The full stored `eval_traces` row shape (used by schema and write seam). */
export const spanRowFields = {
  ...spanMetadataFields,
  ...spanContentFields,
  ...spanStorageFields,
} as const;

/**
 * The span a source provides to record one span: always-recorded metadata
 * plus optional raw content. Storage ids are resolved internally and are
 * not part of the input.
 */
export const spanInputValidator = v.object({
  ...spanMetadataFields,
  ...spanContentFields,
});
export type SpanInput = Infer<typeof spanInputValidator>;

/**
 * Fields a host supplies for one dataset item. Shared by the schema
 * table (which adds `datasetId`) and the dataset CRUD args so the item
 * shape stays in one place.
 */
export const datasetItemFields = {
  input: v.any(),
  expectedOutput: v.optional(v.any()),
  expectedTools: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  slice: v.optional(v.string()),
} as const;

export const datasetItemInputValidator = v.object(datasetItemFields);
export type DatasetItemInput = Infer<typeof datasetItemInputValidator>;

/** Lifecycle status of an eval run. */
export const runStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);
export type RunStatus = Infer<typeof runStatusValidator>;

/** Lifecycle status of a per-item result. `pending` -> `running` is the
 * single-winner claim transition; `success`/`error` are terminal. */
export const resultStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("success"),
  v.literal("error"),
);
export type ResultStatus = Infer<typeof resultStatusValidator>;

/** One scorer's verdict on one result. */
export const scoreRecordValidator = v.object({
  scorer: v.string(),
  score: v.number(),
  passed: v.boolean(),
  details: v.optional(v.any()),
});
export type ScoreRecord = Infer<typeof scoreRecordValidator>;

/**
 * Selection of a scorer in a run config. `exactMatch` and `jsonSchema`
 * run in-component; the handle-based entries (`custom`,
 * `embeddingSimilarity`, `consensus`) invoke host actions resolved to
 * function handles by the client at `startRun`.
 */
export const scorerConfigValidator = v.union(
  v.object({ type: v.literal("exactMatch") }),
  v.object({ type: v.literal("jsonSchema"), schema: v.any() }),
  v.object({
    type: v.literal("custom"),
    name: v.string(),
    handle: v.string(),
    config: v.optional(v.any()),
  }),
  v.object({
    type: v.literal("embeddingSimilarity"),
    embedderHandle: v.string(),
    threshold: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("consensus"),
    name: v.optional(v.string()),
    judgeHandles: v.array(v.string()),
    quorum: v.optional(v.number()),
  }),
);
export type ScorerConfig = Infer<typeof scorerConfigValidator>;

/** Default pass threshold for `embeddingSimilarity`. */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

/**
 * What a handle-based scorer action receives for one item. Shared by
 * `defineScorer` (host-side validators) and the worker (caller).
 */
export const scorerArgsFields = {
  input: v.any(),
  output: v.any(),
  expectedOutput: v.optional(v.any()),
  runId: v.string(),
  itemId: v.string(),
  traceId: v.optional(v.string()),
  config: v.optional(v.any()),
} as const;
export const scorerArgsValidator = v.object(scorerArgsFields);
export type ScorerHandleArgs = Infer<typeof scorerArgsValidator>;

/** A scorer's verdict: score in [0, 1] plus a hard pass/fail. */
export const scorerVerdictValidator = v.object({
  score: v.number(),
  passed: v.boolean(),
  details: v.optional(v.any()),
});
export type ScorerHandleVerdict = Infer<typeof scorerVerdictValidator>;

/**
 * Run configuration: which scorers to apply, how many parallel workers
 * to schedule (default `DEFAULT_RUN_CONCURRENCY`, capped at
 * `MAX_RUN_CONCURRENCY`), an optional pass threshold recorded for
 * downstream consumers, and the per-item attempts cap (default
 * `DEFAULT_MAX_ATTEMPTS`) that bounds both managed retries of retryable
 * target failures and the stuck-row re-drive.
 */
export const runConfigValidator = v.object({
  scorers: v.array(scorerConfigValidator),
  concurrency: v.optional(v.number()),
  passThreshold: v.optional(v.number()),
  maxAttempts: v.optional(v.number()),
});
export type RunConfig = Infer<typeof runConfigValidator>;

export const DEFAULT_RUN_CONCURRENCY = 4;
export const MAX_RUN_CONCURRENCY = 16;
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Default `olderThanMs` cutoff for the stuck-row re-drive. */
export const DEFAULT_REDRIVE_CUTOFF_MS = 10 * 60 * 1000;

/** Base delay before the first managed retry; doubles each attempt. */
export const RETRY_BASE_DELAY_MS = 1000;
/** Cap on the managed-retry backoff, well under the re-drive cutoff so a
 * retrying item is never mistaken for a wedged one. */
export const RETRY_MAX_DELAY_MS = 30 * 1000;

/**
 * Flag key in a `ConvexError`'s `data` that marks a target failure as
 * retryable by the managed-retry loop. Namespaced so it never collides
 * with a host's own error data.
 */
export const RETRYABLE_ERROR_FLAG = "evalbenchRetryable";

/**
 * Build the error a host target throws to ask the runner to retry the
 * item (a transient provider failure, a rate limit, a flaky upstream).
 * A `ConvexError` is used because its `data` payload survives the
 * component call boundary, unlike a plain `Error`'s. Any other throw is
 * finalized as an error without a retry.
 */
export function retryableError(
  message: string,
): ConvexError<{ evalbenchRetryable: true; message: string }> {
  return new ConvexError({ [RETRYABLE_ERROR_FLAG]: true as const, message });
}

/**
 * Whether a caught target failure is retryable. Checked by shape, not
 * `instanceof`, so it holds across the component boundary and any
 * class-identity mismatch: the marked `ConvexError`'s `data` arrives as
 * a plain object on the worker side.
 */
export function isRetryableError(err: unknown): boolean {
  let data = (err as { data?: unknown } | null | undefined)?.data;
  // Real Convex delivers `data` as the original object; some call
  // boundaries (and convex-test) deliver it as its JSON encoding. Accept
  // both so detection holds regardless of how the error crossed.
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return false;
    }
  }
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)[RETRYABLE_ERROR_FLAG] === true
  );
}

/**
 * Exponential backoff before the next managed retry: `BASE * 2^(attempts
 * - 1)`, capped at `RETRY_MAX_DELAY_MS`. `attempts` is the count of
 * tries already made (>= 1), so the first retry waits `BASE`. The
 * exponent is clamped to avoid overflow on pathological caps.
 */
export function retryBackoffMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 20);
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
}

/** Default retention window for `pruneTraces`: spans older than this
 * (by `startedAt`) are prunable. 30 days. */
export const DEFAULT_TRACE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Default and max batch size for one `pruneTraces` call. */
export const DEFAULT_TRACE_PRUNE_LIMIT = 200;
export const MAX_TRACE_PRUNE_LIMIT = 1000;

/**
 * What a target action returns for one item. `traceId` links the result
 * to the trace the target recorded (the target receives the `runId` and
 * should stamp its spans with it).
 */
export const targetResultValidator = v.object({
  output: v.any(),
  traceId: v.optional(v.string()),
});
export type TargetResult = Infer<typeof targetResultValidator>;

/**
 * Content at or below this many bytes (UTF-8) is stored inline on the
 * span row; larger content is offloaded to File Storage. 4 KB keeps
 * typical small prompts inline while moving multi-KB payloads off the
 * hot query path.
 */
export const INLINE_CONTENT_THRESHOLD_BYTES = 4 * 1024;

/** UTF-8 byte length of a string, for the inline/File-Storage decision. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
