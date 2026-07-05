import { ConvexError, v } from "convex/values";

import { datasetItemFields, datasetItemInputValidator } from "../shared.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { mutation, query } from "./_generated/server.js";

/**
 * Versioned evaluation datasets. A dataset row is one version; items
 * belong to exactly one version. `versionDataset` snapshots a new row
 * (with copied items) so a run can pin an immutable version while the
 * host keeps editing the tip.
 */

const datasetValidator = v.object({
  _id: v.id("eval_datasets"),
  _creationTime: v.number(),
  name: v.string(),
  version: v.number(),
  parentVersionId: v.optional(v.id("eval_datasets")),
  description: v.optional(v.string()),
  itemCount: v.number(),
  archived: v.boolean(),
});

const itemValidator = v.object({
  _id: v.id("eval_dataset_items"),
  _creationTime: v.number(),
  datasetId: v.id("eval_datasets"),
  ...datasetItemFields,
});

async function getDatasetOrThrow(
  ctx: MutationCtx,
  datasetId: Id<"eval_datasets">,
): Promise<Doc<"eval_datasets">> {
  const dataset = await ctx.db.get("eval_datasets", datasetId);
  if (!dataset) {
    throw new ConvexError(`dataset not found: ${datasetId}`);
  }
  return dataset;
}

async function insertItems(
  ctx: MutationCtx,
  datasetId: Id<"eval_datasets">,
  items: { input: unknown }[],
): Promise<void> {
  for (const item of items) {
    await ctx.db.insert("eval_dataset_items", { datasetId, ...item });
  }
}

/** Create a dataset at version 1, optionally with initial items. */
export const createDataset = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    items: v.optional(v.array(datasetItemInputValidator)),
  },
  returns: v.id("eval_datasets"),
  handler: async (ctx, args) => {
    const items = args.items ?? [];
    const datasetId = await ctx.db.insert("eval_datasets", {
      name: args.name,
      version: 1,
      ...(args.description !== undefined
        ? { description: args.description }
        : {}),
      itemCount: items.length,
      archived: false,
    });
    await insertItems(ctx, datasetId, items);
    return datasetId;
  },
});

/** Add items to an existing dataset; bumps its `itemCount`. */
export const addItems = mutation({
  args: {
    datasetId: v.id("eval_datasets"),
    items: v.array(datasetItemInputValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dataset = await getDatasetOrThrow(ctx, args.datasetId);
    await insertItems(ctx, args.datasetId, args.items);
    await ctx.db.patch("eval_datasets", args.datasetId, {
      itemCount: dataset.itemCount + args.items.length,
    });
    return null;
  },
});

/** List datasets, excluding archived ones unless requested. */
export const listDatasets = query({
  args: { includeArchived: v.optional(v.boolean()) },
  returns: v.array(datasetValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("eval_datasets").collect();
    return args.includeArchived ? rows : rows.filter((d) => !d.archived);
  },
});

/** All items of a dataset. */
export const listItems = query({
  args: { datasetId: v.id("eval_datasets") },
  returns: v.array(itemValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eval_dataset_items")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
  },
});

/**
 * Snapshot a dataset into a new version: a new row at the name's next
 * version number, linked to the parent and carrying a copy of the
 * parent's items.
 */
export const versionDataset = mutation({
  args: { datasetId: v.id("eval_datasets") },
  returns: v.id("eval_datasets"),
  handler: async (ctx, args) => {
    const parent = await getDatasetOrThrow(ctx, args.datasetId);
    // Next version is max(version for this name) + 1, so versioning an
    // older row still yields a monotonic version per name.
    const latest = await ctx.db
      .query("eval_datasets")
      .withIndex("by_name", (q) => q.eq("name", parent.name))
      .order("desc")
      .first();
    const newId = await ctx.db.insert("eval_datasets", {
      name: parent.name,
      version: (latest?.version ?? parent.version) + 1,
      parentVersionId: args.datasetId,
      ...(parent.description !== undefined
        ? { description: parent.description }
        : {}),
      itemCount: parent.itemCount,
      archived: false,
    });
    const items = await ctx.db
      .query("eval_dataset_items")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    for (const item of items) {
      const { _id, _creationTime, datasetId, ...fields } = item;
      void _id;
      void _creationTime;
      void datasetId;
      await ctx.db.insert("eval_dataset_items", {
        datasetId: newId,
        ...fields,
      });
    }
    return newId;
  },
});

/** Mark a dataset archived; it disappears from the default listing. */
export const archiveDataset = mutation({
  args: { datasetId: v.id("eval_datasets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await getDatasetOrThrow(ctx, args.datasetId);
    await ctx.db.patch("eval_datasets", args.datasetId, { archived: true });
    return null;
  },
});
