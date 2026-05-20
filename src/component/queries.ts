import { v } from "convex/values";
import type { Infer } from "convex/values";

import { spanMetadataFields } from "../shared.js";
import type { Doc } from "./_generated/dataModel.js";
import { query } from "./_generated/server.js";

/**
 * A span as returned by the tree and recent-traces queries: always-recorded
 * metadata plus the `contentRecorded` flag, but no raw content. The live
 * tree renders from these; raw content is fetched on demand via
 * `spanContent` so reactive updates stay small.
 */
const spanSummaryValidator = v.object({
  _id: v.id("eval_traces"),
  _creationTime: v.number(),
  ...spanMetadataFields,
  contentRecorded: v.optional(v.boolean()),
});

type SpanSummary = Infer<typeof spanSummaryValidator>;

/** Strip raw content and storage ids, leaving the metadata summary. */
function toSummary(row: Doc<"eval_traces">): SpanSummary {
  const { input, output, inputStorageId, outputStorageId, ...summary } = row;
  void input;
  void output;
  void inputStorageId;
  void outputStorageId;
  return summary;
}

/**
 * All spans of a trace, oldest first, metadata only. Reactive: as each
 * LLM or tool call records a span, subscribers receive it and the tree
 * fills in live. Raw content is never returned here.
 */
export const spansByTrace = query({
  args: { traceId: v.string() },
  returns: v.array(spanSummaryValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("eval_traces")
      .withIndex("by_trace", (q) => q.eq("traceId", args.traceId))
      .collect();
    return rows.map(toSummary);
  },
});

/**
 * Recent traces: root spans (those without a `parentSpanId`) newest first,
 * limited to `limit` (default 50, capped at 200). Metadata only.
 */
export const recentTraces = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(spanSummaryValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await ctx.db
      .query("eval_traces")
      .withIndex("by_parent_started", (q) => q.eq("parentSpanId", undefined))
      .order("desc")
      .take(limit);
    return rows.map(toSummary);
  },
});

/**
 * Resolve a span's recorded content on demand. Inline content is returned
 * directly; content held in File Storage is returned as a signed URL the
 * client fetches lazily when a span is expanded. `spanId` is the
 * `eval_traces` document id surfaced by `spansByTrace`.
 */
export const spanContent = query({
  args: { spanId: v.id("eval_traces") },
  returns: v.object({
    input: v.optional(v.string()),
    output: v.optional(v.string()),
    inputUrl: v.optional(v.union(v.string(), v.null())),
    outputUrl: v.optional(v.union(v.string(), v.null())),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("eval_traces", args.spanId);
    if (!row) return {};
    return {
      ...(row.input !== undefined ? { input: row.input } : {}),
      ...(row.output !== undefined ? { output: row.output } : {}),
      ...(row.inputStorageId !== undefined
        ? { inputUrl: await ctx.storage.getUrl(row.inputStorageId) }
        : {}),
      ...(row.outputStorageId !== undefined
        ? { outputUrl: await ctx.storage.getUrl(row.outputStorageId) }
        : {}),
    };
  },
});
