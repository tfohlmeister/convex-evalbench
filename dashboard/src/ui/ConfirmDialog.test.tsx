import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./Dialog";

describe("ConfirmDialog", () => {
  it("keeps the confirm button disabled until the text matches", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Archive thing"
        confirmText="thing"
        confirmLabel="Archive"
      />,
    );

    const confirm = screen.getByRole("button", { name: "Archive" });
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText("Type thing to confirm");
    await userEvent.type(input, "thin");
    expect(confirm).toBeDisabled();

    await userEvent.type(input, "g");
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does not confirm on a mismatch", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Archive thing"
        confirmText="thing"
      />,
    );
    await userEvent.type(
      screen.getByLabelText("Type thing to confirm"),
      "wrong",
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
