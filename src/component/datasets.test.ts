import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";

describe("datasets", () => {
  test("create an empty dataset at version 1", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.datasets.createDataset, { name: "greetings" });

    const datasets = await t.query(api.datasets.listDatasets, {});
    expect(datasets).toHaveLength(1);
    expect(datasets[0]).toMatchObject({
      name: "greetings",
      version: 1,
      itemCount: 0,
      archived: false,
    });
  });

  test("create a dataset with initial items", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await t.mutation(api.datasets.createDataset, {
      name: "greetings",
      items: [
        { input: "hi", expectedOutput: "hello" },
        { input: "bye", expectedOutput: "goodbye", tags: ["farewell"] },
      ],
    });

    const datasets = await t.query(api.datasets.listDatasets, {});
    expect(datasets[0].itemCount).toBe(2);
    const items = await t.query(api.datasets.listItems, { datasetId });
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.input)).toEqual(["hi", "bye"]);
  });

  test("addItems appends and bumps itemCount; no cross-dataset leakage", async () => {
    const t = convexTest(schema, modules);
    const a = await t.mutation(api.datasets.createDataset, {
      name: "a",
      items: [{ input: 1 }],
    });
    const b = await t.mutation(api.datasets.createDataset, {
      name: "b",
      items: [{ input: "other" }],
    });

    await t.mutation(api.datasets.addItems, {
      datasetId: a,
      items: [{ input: 2 }, { input: 3 }],
    });

    const itemsA = await t.query(api.datasets.listItems, { datasetId: a });
    expect(itemsA.map((i) => i.input)).toEqual([1, 2, 3]);
    const itemsB = await t.query(api.datasets.listItems, { datasetId: b });
    expect(itemsB.map((i) => i.input)).toEqual(["other"]);
    const datasets = await t.query(api.datasets.listDatasets, {});
    expect(datasets.find((d) => d._id === a)?.itemCount).toBe(3);
  });

  test("addItems to a missing dataset is rejected", async () => {
    const t = convexTest(schema, modules);
    const datasetId = await t.mutation(api.datasets.createDataset, {
      name: "temp",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("eval_datasets", datasetId);
    });

    await expect(
      t.mutation(api.datasets.addItems, {
        datasetId,
        items: [{ input: 1 }],
      }),
    ).rejects.toThrow(/dataset not found/);
  });

  test("versionDataset snapshots items and links the parent", async () => {
    const t = convexTest(schema, modules);
    const v1 = await t.mutation(api.datasets.createDataset, {
      name: "versioned",
      items: [{ input: "x", expectedOutput: "y" }],
    });

    const v2 = await t.mutation(api.datasets.versionDataset, {
      datasetId: v1,
    });

    const datasets = await t.query(api.datasets.listDatasets, {});
    const v2Row = datasets.find((d) => d._id === v2);
    expect(v2Row).toMatchObject({
      name: "versioned",
      version: 2,
      parentVersionId: v1,
      itemCount: 1,
    });

    // Items are copies: mutating the parent afterwards leaves v2 alone.
    await t.mutation(api.datasets.addItems, {
      datasetId: v1,
      items: [{ input: "z" }],
    });
    const v2Items = await t.query(api.datasets.listItems, { datasetId: v2 });
    expect(v2Items).toHaveLength(1);
    expect(v2Items[0]).toMatchObject({ input: "x", expectedOutput: "y" });
  });

  test("archive hides a dataset from the default listing", async () => {
    const t = convexTest(schema, modules);
    const keep = await t.mutation(api.datasets.createDataset, {
      name: "keep",
    });
    const gone = await t.mutation(api.datasets.createDataset, {
      name: "gone",
    });

    await t.mutation(api.datasets.archiveDataset, { datasetId: gone });

    const active = await t.query(api.datasets.listDatasets, {});
    expect(active.map((d) => d._id)).toEqual([keep]);
    const all = await t.query(api.datasets.listDatasets, {
      includeArchived: true,
    });
    expect(all).toHaveLength(2);
  });
});
