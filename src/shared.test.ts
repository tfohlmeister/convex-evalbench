import { describe, expect, it } from "vitest";

import {
  EVALBENCH_VERSION,
  isNonEmptyString,
  isRetryableError,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  retryableError,
  retryBackoffMs,
} from "./shared.js";

describe("shared", () => {
  it("exposes a version string", () => {
    expect(typeof EVALBENCH_VERSION).toBe("string");
  });

  it("detects non-empty strings", () => {
    expect(isNonEmptyString(" x ")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString("")).toBe(false);
  });
});

describe("retryable errors", () => {
  it("round-trips a retryable error through the shape check", () => {
    const err = retryableError("rate limited");
    expect(isRetryableError(err)).toBe(true);
    // The message is carried in the ConvexError data payload.
    expect((err.data as { message: string }).message).toBe("rate limited");
  });

  it("treats a bare object with the flag as retryable (boundary-safe)", () => {
    // The worker sees the ConvexError's data re-materialised across the
    // component call; detection must not depend on class identity.
    expect(isRetryableError({ data: { evalbenchRetryable: true } })).toBe(true);
  });

  it("accepts a JSON-encoded data payload (call-boundary encoding)", () => {
    // Some boundaries deliver ConvexError data as its JSON string.
    expect(
      isRetryableError({ data: JSON.stringify({ evalbenchRetryable: true }) }),
    ).toBe(true);
    expect(isRetryableError({ data: "not json" })).toBe(false);
  });

  it("rejects plain errors and foreign data", () => {
    expect(isRetryableError(new Error("nope"))).toBe(false);
    expect(isRetryableError({ data: { evalbenchRetryable: false } })).toBe(
      false,
    );
    expect(isRetryableError({ data: { other: true } })).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError("boom")).toBe(false);
  });
});

describe("retry backoff", () => {
  it("grows exponentially from the base delay", () => {
    expect(retryBackoffMs(1)).toBe(RETRY_BASE_DELAY_MS);
    expect(retryBackoffMs(2)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(retryBackoffMs(3)).toBe(RETRY_BASE_DELAY_MS * 4);
  });

  it("caps at the maximum and never overflows", () => {
    expect(retryBackoffMs(1000)).toBe(RETRY_MAX_DELAY_MS);
    expect(retryBackoffMs(0)).toBe(RETRY_BASE_DELAY_MS);
  });
});
