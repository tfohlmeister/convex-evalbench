#!/usr/bin/env node
/* global console, process */

/**
 * Backend-level proof that the span tree fills in live over a Convex
 * subscription (the reactive payoff of recording spans inside the host's
 * own deployment). No browser UI: a `ConvexClient` subscribes to the
 * host's `listSpans` query, then we append a span and assert the
 * subscription pushes the new span without re-querying.
 *
 * Run against the local backend (started via `pnpm local:start`) after
 * deploying the example (`npx convex dev --once`):
 *
 *     node example/live-proof.mjs
 */

import { ConvexClient } from "convex/browser";

import { api } from "./convex/_generated/api.js";

const URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3312";

function deadline(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms),
  );
}

const client = new ConvexClient(URL);

try {
  // 1. Record a small trace (root + two children).
  const { traceId, rootSpanId } = await client.action(
    api.demo.recordDemoTrace,
    {},
  );
  console.log(`recorded trace ${traceId}`);

  // 2. Subscribe to the live span tree and collect snapshots.
  const snapshots = [];
  let notify = () => {};
  const unsubscribe = client.onUpdate(
    api.demo.listSpans,
    { traceId },
    (spans) => {
      snapshots.push(spans.length);
      notify();
    },
  );

  const waitFor = (predicate, label) =>
    Promise.race([
      new Promise((resolve) => {
        const check = () => {
          if (predicate()) resolve();
          else notify = check;
        };
        check();
      }),
      deadline(10_000, label),
    ]);

  // 3. First snapshot should carry the three recorded spans.
  await waitFor(
    () => snapshots.at(-1) === 3,
    "initial 3-span snapshot",
  );
  console.log(`initial subscription snapshot: ${snapshots.at(-1)} spans`);

  // 4. Append a span; the subscription must push a 4-span snapshot with no
  //    manual re-query.
  await client.action(api.demo.addDemoSpan, {
    traceId,
    parentSpanId: rootSpanId,
  });
  await waitFor(
    () => snapshots.at(-1) === 4,
    "live update to 4 spans",
  );
  console.log(`after addDemoSpan, live snapshot: ${snapshots.at(-1)} spans`);

  unsubscribe();
  console.log(`snapshot sequence: ${snapshots.join(" -> ")}`);
  console.log("PASS: span tree filled in live over the subscription");
  await client.close();
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err.message);
  await client.close();
  process.exit(1);
}
