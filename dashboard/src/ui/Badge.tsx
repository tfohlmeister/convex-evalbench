import type { ReactNode } from "react";

export type BadgeTone = "ok" | "warn" | "danger" | "muted" | "info" | "accent";

const TONE_CLASS: Record<BadgeTone, string> = {
  ok: "pill-ok",
  warn: "pill-warn",
  danger: "pill-danger",
  muted: "pill-muted",
  info: "pill-info",
  accent: "pill-accent",
};

export function Badge({
  tone,
  live = false,
  children,
}: {
  tone: BadgeTone;
  /** Pulse the status dot (for in-progress states). */
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`pill ${TONE_CLASS[tone]} ${live ? "pulse-dot" : ""}`}>
      {children}
    </span>
  );
}
