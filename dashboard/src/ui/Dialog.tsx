import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./Button";

type Tone = "accent" | "danger" | "ink";

const TONE_BORDER: Record<Tone, string> = {
  accent: "border-t-[var(--color-accent)]",
  danger: "border-t-[var(--color-danger)]",
  ink: "border-t-[var(--color-ink)]",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  tone?: Tone;
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * An accessible modal: focus moves into the dialog on open and is
 * restored to the trigger on close, Escape closes it, Tab is trapped
 * within it, and it is marked `aria-modal`. Keeps the orchestrator's
 * colored top-border look. Rendered inline (no portal) as a fixed
 * overlay.
 */
export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  tone = "accent",
  children,
  footer,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the first focusable control, else the panel itself.
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(28,25,23,0.45)] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`card border-t-4 ${TONE_BORDER[tone]} w-[32rem] max-w-full p-6 shadow-2xl outline-none`}
      >
        {eyebrow && (
          <div
            className={`eyebrow mb-2 ${tone === "danger" ? "text-[var(--color-danger)]" : ""}`}
          >
            {eyebrow}
          </div>
        )}
        <h2
          id={titleId}
          className="display text-[24px] leading-tight mb-4"
        >
          {title}
        </h2>
        {children}
        {footer && <div className="flex justify-end gap-2 mt-6">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  eyebrow?: string;
  /** The exact text the user must type to enable the confirm button. */
  confirmText: string;
  confirmLabel?: string;
  pending?: boolean;
  error?: string | null;
  children?: ReactNode;
}

/**
 * A destructive confirmation built on `Dialog`: the confirm button stays
 * disabled until the user types `confirmText` verbatim, so an
 * irreversible action cannot fire on a stray click.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  eyebrow = "Destructive · irreversible",
  confirmText,
  confirmLabel = "Delete",
  pending = false,
  error = null,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const match = typed === confirmText;

  // Reset the typed value whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      eyebrow={eyebrow}
      tone="danger"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructiveSolid"
            disabled={!match || pending}
            onClick={() => void onConfirm()}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      <label className="block text-[12px] text-[var(--color-muted)] mt-4 mb-1.5">
        Type{" "}
        <code className="font-mono text-[var(--color-ink)]">{confirmText}</code>{" "}
        to confirm
      </label>
      <input
        autoFocus
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="input"
        aria-label={`Type ${confirmText} to confirm`}
      />
      {error && (
        <p className="text-[12px] text-[var(--color-danger)] mt-2">{error}</p>
      )}
    </Dialog>
  );
}
