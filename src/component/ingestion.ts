import { v } from "convex/values";

import {
  byteLength,
  DEFAULT_TRACE_PRUNE_LIMIT,
  DEFAULT_TRACE_RETENTION_MS,
  INLINE_CONTENT_THRESHOLD_BYTES,
  MAX_TRACE_PRUNE_LIMIT,
  spanContentFields,
  spanMetadataFields,
  spanRowFields,
} from "../shared.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { action, internalMutation, mutation } from "./_generated/server.js";

/**
 * The single ingestion write seam. Every span, from any source and either
 * ingestion path, funnels through this one internal mutation, which is the
 * only place that inserts an `eval_traces` row. Keeping all writes here
 * leaves room to add self-managed batching or rate limiting later without
 * touching any caller or the public API.
 */
export const writeSpanRow = internalMutation({
  args: spanRowFields,
  returns: v.id("eval_traces"),
  handler: async (ctx, row) => {
    return await ctx.db.insert("eval_traces", row);
  },
});

/**
 * Metadata-only fast path. Records a span with no raw content, going
 * straight to the write seam and skipping the action hop. Used for spans
 * with content recording off and for spans that carry no content (e.g. a
 * usage-only span).
 */
export const recordSpan = mutation({
  args: spanMetadataFields,
  returns: v.id("eval_traces"),
  // Explicit return type: the handler calls a function in this same
  // module via `internal.ingestion.*`, so without it tsc would infer the
  // type through `internal` and hit a circular reference.
  handler: async (ctx, metadata): Promise<Id<"eval_traces">> => {
    return await ctx.runMutation(internal.ingestion.writeSpanRow, {
      ...metadata,
      contentRecorded: false,
    });
  },
});

/**
 * Content path. Records a span whose source opted into content recording.
 * Per content field, content at or below the inline threshold is stored
 * inline on the row; larger content is offloaded to File Storage and the
 * row holds the storage id instead. Then forwards to the write seam.
 *
 * An action because `ctx.storage.store` is an action-only capability.
 */
export const recordSpanWithContent = action({
  args: { ...spanMetadataFields, ...spanContentFields },
  returns: v.id("eval_traces"),
  handler: async (ctx, args): Promise<Id<"eval_traces">> => {
    const { input, output, ...metadata } = args;

    const stored = {
      input: undefined as string | undefined,
      output: undefined as string | undefined,
      inputStorageId: undefined as Id<"_storage"> | undefined,
      outputStorageId: undefined as Id<"_storage"> | undefined,
    };

    for (const field of ["input", "output"] as const) {
      const content = field === "input" ? input : output;
      if (content === undefined) continue;
      if (byteLength(content) <= INLINE_CONTENT_THRESHOLD_BYTES) {
        stored[field] = content;
      } else {
        const storageId = await ctx.storage.store(new Blob([content]));
        const idField = field === "input" ? "inputStorageId" : "outputStorageId";
        stored[idField] = storageId;
      }
    }

    return await ctx.runMutation(internal.ingestion.writeSpanRow, {
      ...metadata,
      ...(stored.input !== undefined ? { input: stored.input } : {}),
      ...(stored.output !== undefined ? { output: stored.output } : {}),
      ...(stored.inputStorageId !== undefined
        ? { inputStorageId: stored.inputStorageId }
        : {}),
      ...(stored.outputStorageId !== undefined
        ? { outputStorageId: stored.outputStorageId }
        : {}),
      contentRecorded: true,
    });
  },
});

/**
 * Batch metadata-only write. Records many spans with no raw content in one
 * transaction, each through the same `writeSpanRow` seam the single-span
 * path uses, so a high-volume source (the OTLP receiver) ingests without
 * one mutation per span. Content-bearing spans still take the
 * `recordSpanWithContent` path individually.
 */
export const recordSpansBatch = mutation({
  args: { spans: v.array(v.object(spanMetadataFields)) },
  returns: v.array(v.id("eval_traces")),
  handler: async (ctx, { spans }): Promise<Id<"eval_traces">[]> => {
    const ids: Id<"eval_traces">[] = [];
    for (const metadata of spans) {
      ids.push(
        await ctx.runMutation(internal.ingestion.writeSpanRow, {
          ...metadata,
          contentRecorded: false,
        }),
      );
    }
    return ids;
  },
});

/**
 * Host-invoked retention: delete trace spans older than `olderThanMs`
 * (by `startedAt`, default 30 days) in one bounded batch, cascading to
 * delete each span's File Storage content objects so nothing is
 * orphaned. Returns `{ deleted, hasMore }`; `hasMore` is true when the
 * batch filled to `limit`, so the host loops (manually or from its own
 * cron) until it is false. A mutation, not an action: `ctx.storage.delete`
 * works here, so each row and its blobs drop in one transaction, and a
 * retried batch is safe (deleting an already-deleted storage id is a
 * no-op). Mirrors `redriveRun`: the component ships the operation, the
 * host schedules it.
 */
export const pruneTraces = mutation({
  args: {
    olderThanMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    // A non-finite or negative age must not widen the window to "now"
    // and delete fresh spans; fall back to the default (as redriveRun
    // does for its cutoff).
    const retentionMs =
      Number.isFinite(args.olderThanMs) && (args.olderThanMs as number) >= 0
        ? (args.olderThanMs as number)
        : DEFAULT_TRACE_RETENTION_MS;
    const cutoff = Date.now() - retentionMs;
    const limit = Math.min(
      Math.max(
        Number.isFinite(args.limit)
          ? Math.floor(args.limit as number)
          : DEFAULT_TRACE_PRUNE_LIMIT,
        1,
      ),
      MAX_TRACE_PRUNE_LIMIT,
    );

    const spans = await ctx.db
      .query("eval_traces")
      .withIndex("by_started", (q) => q.lt("startedAt", cutoff))
      .take(limit);

    for (const span of spans) {
      if (span.inputStorageId !== undefined) {
        await ctx.storage.delete(span.inputStorageId);
      }
      if (span.outputStorageId !== undefined) {
        await ctx.storage.delete(span.outputStorageId);
      }
      await ctx.db.delete("eval_traces", span._id);
    }

    return { deleted: spans.length, hasMore: spans.length === limit };
  },
});
