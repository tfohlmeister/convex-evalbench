import { Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";

/**
 * Built-in deterministic scorers. Isomorphic: no Convex runtime imports,
 * so the module is unit-testable directly and usable client- and
 * component-side. The `jsonSchema` scorer uses `@cfworker/json-schema`,
 * an interpreted (eval-free) validator, because Convex's V8 runtime
 * forbids dynamic code evaluation (`eval` / `new Function`), which rules
 * out ajv's default compiled mode.
 */

/** What a scorer receives for one result. */
export type ScorerArgs = {
  /** The target's output for the item. */
  output: unknown;
  /** The item's expected output, when the dataset provides one. */
  expectedOutput?: unknown;
};

/** A scorer's verdict: score in [0, 1] plus a hard pass/fail. */
export type ScorerVerdict = {
  score: number;
  passed: boolean;
  details?: unknown;
};

/** Structural deep equality over Convex-value shapes. */
function deepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // Convex `Bytes` values: compare content, not (always-empty) keys.
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
    if (!(a instanceof ArrayBuffer) || !(b instanceof ArrayBuffer)) {
      return false;
    }
    if (a.byteLength !== b.byteLength) return false;
    const aBytes = new Uint8Array(a);
    const bBytes = new Uint8Array(b);
    return aBytes.every((byte, i) => byte === bBytes[i]);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((el, i) => deepEquals(el, b[i]))
    );
  }
  if (
    typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) =>
        deepEquals(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
      )
    );
  }
  return false;
}

/**
 * Deep-equals the output against the item's `expectedOutput`.
 * Score 1 on equality, else 0.
 */
export function exactMatch(args: ScorerArgs): ScorerVerdict {
  const equal = deepEquals(args.output, args.expectedOutput);
  return { score: equal ? 1 : 0, passed: equal };
}

/**
 * Validates the output against a JSON Schema. Score 1 when valid, else
 * 0 with the validation errors in `details`.
 */
export function jsonSchema(
  args: ScorerArgs,
  schema: Record<string, unknown> | boolean,
): ScorerVerdict {
  const validator = new Validator(schema as Schema);
  const result = validator.validate(args.output);
  if (result.valid) return { score: 1, passed: true };
  return {
    score: 0,
    passed: false,
    details: {
      errors: result.errors.map((e) => ({
        keyword: e.keyword,
        instanceLocation: e.instanceLocation,
        error: e.error,
      })),
    },
  };
}
