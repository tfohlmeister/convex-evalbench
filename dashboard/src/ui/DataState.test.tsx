import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataState } from "./DataState";

describe("DataState", () => {
  it("renders the loading state while data is undefined", () => {
    render(
      <DataState data={undefined} loadingLabel="Loading things">
        {() => <div>content</div>}
      </DataState>,
    );
    expect(screen.getByText("Loading things")).toBeInTheDocument();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("renders the empty state for an empty array", () => {
    render(
      <DataState data={[]} emptyTitle="Nothing found">
        {() => <div>content</div>}
      </DataState>,
    );
    expect(screen.getByText("Nothing found")).toBeInTheDocument();
  });

  it("renders the empty state for null", () => {
    render(
      <DataState data={null} emptyTitle="Missing">
        {() => <div>content</div>}
      </DataState>,
    );
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("renders the error state when an error is passed", () => {
    render(
      <DataState data={undefined} error={new Error("boom")}>
        {() => <div>content</div>}
      </DataState>,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders children with the data when present and non-empty", () => {
    render(
      <DataState data={["a", "b"]}>
        {(rows) => <div>rows: {rows.length}</div>}
      </DataState>,
    );
    expect(screen.getByText("rows: 2")).toBeInTheDocument();
  });
});
