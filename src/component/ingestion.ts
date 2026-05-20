import { v } from "convex/values";

import {
  byteLength,
  INLINE_CONTENT_THRESHOLD_BYTES,
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
