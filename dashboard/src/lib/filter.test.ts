import { describe, expect, it } from "vitest";
import { filterList } from "./filter";

interface Row {
  name: string;
  status: string;
}

const rows: Row[] = [
  { name: "alpha", status: "success" },
  { name: "beta", status: "error" },
  { name: "gamma", status: "success" },
];

const search = (r: Row) => [r.name];
const status = (r: Row) => r.status;

describe("filterList", () => {
  it("returns all rows for an empty filter", () => {
    expect(
      filterList(rows, { text: "", status: null }, search, status),
    ).toHaveLength(3);
  });

  it("filters by status", () => {
    const out = filterList(
      rows,
      { text: "", status: "success" },
      search,
      status,
    );
    expect(out.map((r) => r.name)).toEqual(["alpha", "gamma"]);
  });

  it("filters by case-insensitive text match", () => {
    const out = filterList(rows, { text: "BET", status: null }, search, status);
    expect(out.map((r) => r.name)).toEqual(["beta"]);
  });

  it("combines status and text (AND)", () => {
    const out = filterList(
      rows,
      { text: "a", status: "success" },
      search,
      status,
    );
    expect(out.map((r) => r.name)).toEqual(["alpha", "gamma"]);
  });

  it("ignores undefined searchable fields", () => {
    const out = filterList(
      rows,
      { text: "alpha", status: null },
      () => [undefined],
      status,
    );
    expect(out).toHaveLength(0);
  });
});
