/**
 * Types and pure helpers shared between the client (`src/client`) and the
 * component (`src/component`). Keep this free of Convex runtime imports so
 * both sides can use it without pulling in server-only code.
 */

export const EVALBENCH_VERSION = "0.0.0";

/** True when `value` contains at least one non-whitespace character. */
export function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}
