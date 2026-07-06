import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, VARIANT_CLASS } from "./Button";

describe("Button", () => {
  it("maps each variant to its semantic class", () => {
    expect(VARIANT_CLASS.primary).toBe("btn-primary");
    expect(VARIANT_CLASS.secondary).toBe("btn-ghost");
    expect(VARIANT_CLASS.destructive).toBe("btn-danger");
    expect(VARIANT_CLASS.destructiveSolid).toBe("btn-danger-solid");
    expect(VARIANT_CLASS.accent).toBe("btn-accent");
  });

  it("applies the variant and size classes", () => {
    render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toHaveClass("btn", "btn-danger", "btn-sm");
  });

  it("defaults to type=button so it never submits a form implicitly", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Click" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
