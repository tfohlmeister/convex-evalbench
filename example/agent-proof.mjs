#!/usr/bin/env node
/* global console, process */

/**
 * Live verification of the convex-agent adapter: a real `@convex-dev/agent`
 * agent wrapped with `withEvalbench` makes a real LLM call, and the trace
 * appears live over a subscription and renders as a tree (root `agent_step`
 * span plus an `llm` child carrying model/provider/usage and resolvable
 * content).
 *
 * Requires the local backend (`pnpm local:start`), the example deployed
 * (`npx convex dev --once`), and `ANTHROPIC_API_KEY` set on the backend
 * (`npx convex env set ANTHROPIC_API_KEY ...`). Run:
 *
 *     node example/agent-proof.mjs
 */

import { ConvexClient } from "convex/browser";

import { api } from "./convex/_generated/api.js";

const URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3312";
const client = new ConvexClient(URL);

function deadline(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms),
  );
}

function fail(msg) {
  throw new Error(msg);
}

try {
  // 1. Subscribe to recent traces and capture the starting roots.
  let roots = [];
  let gotSnapshot = false;
  let notify = () => {};
  const unsubRecent = client.onUpdate(
    api.demo.listRecentTraces,
    { limit: 20 },
    (traces) => {
      roots = traces;
      gotSnapshot = true;
      notify();
    },
  );
  const waitFor = (predicate, label) =>
    Promise.race([
      new Promise((resolve) => {
        const check = () => (predicate() ? resolve() : (notify = check));
        check();
      }),
      deadline(30_000, label),
    ]);

  await waitFor(() => gotSnapshot, "initial recent-traces snapshot");
  const before = new Set(roots.map((r) => r.traceId));
  console.log(`starting with ${before.size} traces`);

  // 2. Run the real wrapped agent (real Anthropic call).
  const { text } = await client.action(api.agentDemo.runAgentDemo, {
    prompt: "In one word, what color is the sky on a clear day?",
  });
  console.log(`agent answered: ${JSON.stringify(text)}`);

  // 3. A new root trace must appear live over the subscription.
  await waitFor(
    () => roots.some((r) => !before.has(r.traceId)),
    "new agent trace to appear live",
  );
  const root = roots.find((r) => !before.has(r.traceId));
  if (root.kind !== "agent_step") fail(`root kind is ${root.kind}`);
  if (root.status !== "success") fail(`root status is ${root.status}`);
  console.log(`new trace appeared live: ${root.traceId} (${root.operationName})`);

  // 4. The span tree must contain an llm child carrying usage.
  const spans = await client.query(api.demo.listSpans, {
    traceId: root.traceId,
  });
  const llm = spans.find((s) => s.kind === "llm");
  if (!llm) fail("no llm span recorded under the agent trace");
  if (llm.parentSpanId !== root.spanId) fail("llm span not linked to root");
  if (!llm.model || !llm.provider) fail("llm span missing model/provider");
  if (llm.totalTokens === undefined) fail("llm span missing token usage");
  console.log(
    `llm span: model=${llm.model} provider=${llm.provider} ` +
      `tokens=${llm.inputTokens}/${llm.outputTokens}/${llm.totalTokens}`,
  );

  // 5. Recorded content resolves on demand (inline or signed URL).
  if (llm.contentRecorded) {
    const content = await client.query(api.demo.getSpanContent, {
      spanId: llm._id,
    });
    const hasContent =
      content.input !== undefined ||
      content.output !== undefined ||
      content.inputUrl ||
      content.outputUrl;
    if (!hasContent) fail("contentRecorded but spanContent returned nothing");
    const where =
      content.inputUrl || content.outputUrl ? "File Storage (signed URL)" : "inline";
    console.log(`content resolved (${where})`);
  }

  unsubRecent();
  console.log("PASS: real agent operation rendered as a live trace tree");
  await client.close();
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err.message);
  await client.close();
  process.exit(1);
}
