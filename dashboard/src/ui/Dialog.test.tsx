import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dialog } from "./Dialog";

function Harness({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Test dialog">
      <button>first</button>
      <button>second</button>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("renders as an accessible modal", () => {
    render(<Harness onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Test dialog");
  });

  it("moves focus into the dialog on open", () => {
    render(<Harness onClose={() => {}} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "first" }),
    );
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when the panel itself is clicked", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab focus within the dialog", () => {
    render(<Harness onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "first" });
    const second = screen.getByRole("button", { name: "second" });

    // Forward wrap: Tab from the last element returns to the first.
    second.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Backward wrap: Shift+Tab from the first element goes to the last.
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(second);
  });

  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Hidden">
        body
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
