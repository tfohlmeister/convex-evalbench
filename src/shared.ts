/**
 * Types and pure helpers shared between the client (`src/client`) and the
 * component (`src/component`). Imports are limited to `convex/values`,
 * which is isomorphic (the validator builder runs client- and server-side
 * alike); keep server-only runtime imports out so both sides can use this.
 */

import { v } from "convex/values";
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

/** Selection of a built-in scorer in a run config. */
export const scorerConfigValidator = v.union(
  v.object({ type: v.literal("exactMatch") }),
  v.object({ type: v.literal("jsonSchema"), schema: v.any() }),
);
export type ScorerConfig = Infer<typeof scorerConfigValidator>;

/**
 * Run configuration: which scorers to apply, how many parallel workers
 * to schedule (default `DEFAULT_RUN_CONCURRENCY`, capped at
 * `MAX_RUN_CONCURRENCY`), and an optional pass threshold recorded for
 * downstream consumers.
 */
export const runConfigValidator = v.object({
  scorers: v.array(scorerConfigValidator),
  concurrency: v.optional(v.number()),
  passThreshold: v.optional(v.number()),
});
export type RunConfig = Infer<typeof runConfigValidator>;

export const DEFAULT_RUN_CONCURRENCY = 4;
export const MAX_RUN_CONCURRENCY = 16;

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
