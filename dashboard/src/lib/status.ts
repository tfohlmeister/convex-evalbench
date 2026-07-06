import type { BadgeTone } from "../ui";

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";
export type ResultStatus = "pending" | "running" | "success" | "error";
export type SpanStatus = "running" | "success" | "error";
export type Classification =
  | "regressed"
  | "improved"
  | "unchanged"
  | "incomplete";

interface ToneSpec {
  tone: BadgeTone;
  live: boolean;
}

/** Run lifecycle -> badge tone; `running`/`queued` pulse. */
export function runStatusTone(status: RunStatus): ToneSpec {
  switch (status) {
    case "completed":
      return { tone: "ok", live: false };
    case "running":
      return { tone: "info", live: true };
    case "queued":
      return { tone: "warn", live: true };
    case "failed":
      return { tone: "danger", live: false };
    case "canceled":
      return { tone: "muted", live: false };
  }
}

/** Per-item result status -> badge tone. */
export function resultStatusTone(status: ResultStatus): ToneSpec {
  switch (status) {
    case "success":
      return { tone: "ok", live: false };
    case "error":
      return { tone: "danger", live: false };
    case "running":
      return { tone: "info", live: true };
    case "pending":
      return { tone: "muted", live: true };
  }
}

/** Span status -> badge tone. */
export function spanStatusTone(status: SpanStatus): ToneSpec {
  switch (status) {
    case "success":
      return { tone: "ok", live: false };
    case "error":
      return { tone: "danger", live: false };
    case "running":
      return { tone: "info", live: true };
  }
}

/** Compare classification -> badge tone. */
export function classificationTone(c: Classification): BadgeTone {
  switch (c) {
    case "improved":
      return "ok";
    case "regressed":
      return "danger";
    case "unchanged":
      return "muted";
    case "incomplete":
      return "warn";
  }
}
