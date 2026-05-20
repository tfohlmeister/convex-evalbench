import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";

import type { ComponentApi } from "../component/_generated/component.js";
import type { SpanInput } from "../shared.js";

export { EVALBENCH_VERSION } from "../shared.js";
export {
  spanInputValidator,
  spanKindValidator,
  spanStatusValidator,
  type SpanInput,
  type SpanKind,
  type SpanStatus,
} from "../shared.js";

export type RunQueryCtx = {
  runQuery: <Query extends FunctionReference<"query", "internal" | "public">>(
    query: Query,
    args: FunctionArgs<Query>,
  ) => Promise<FunctionReturnType<Query>>;
};

export type RunMutationCtx = RunQueryCtx & {
  runMutation: <
    Mutation extends FunctionReference<"mutation", "internal" | "public">,
  >(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
  ) => Promise<FunctionReturnType<Mutation>>;
};

export type RunActionCtx = RunMutationCtx & {
  runAction: <
    Action extends FunctionReference<"action", "internal" | "public">,
  >(
    action: Action,
    args: FunctionArgs<Action>,
  ) => Promise<FunctionReturnType<Action>>;
};

/**
 * Host-app handle for the evalbench component.
 *
 * Construct one with the generated `components.evalbench` and use it to
 * record traces and read them back as a live span tree. Span recording is
 * source-agnostic: the convex-agent adapter, future ingestion sources, and
 * manual host instrumentation all funnel through `recordSpan`.
 *
 * ```ts
 * import { Evalbench } from "convex-evalbench";
 * import { components } from "./_generated/api.js";
 *
 * const evalbench = new Evalbench(components.evalbench);
 * ```
 */
export class Evalbench {
  constructor(public component: ComponentApi) {}

  /**
   * Record one span. Best-effort: a recording failure is logged and
   * swallowed, never thrown back into the caller's code path, so a lost
   * span never breaks the LLM call it was tracing.
   *
   * Content routing: spans carrying raw `input`/`output` go through the
   * component action (which stores large content in File Storage and
   * inlines small content); spans without content take the metadata-only
   * fast path straight to the write seam. When content is present but the
   * caller's `ctx` cannot run actions (a query/mutation context), the span
   * is still recorded, with content dropped.
   */
  async recordSpan(
    ctx: RunMutationCtx | RunActionCtx,
    span: SpanInput,
  ): Promise<void> {
    try {
      const hasContent = span.input !== undefined || span.output !== undefined;
      if (hasContent && "runAction" in ctx) {
        await ctx.runAction(
          this.component.ingestion.recordSpanWithContent,
          span,
        );
        return;
      }
      const { input, output, ...metadata } = span;
      void input;
      void output;
      await ctx.runMutation(this.component.ingestion.recordSpan, metadata);
    } catch (err) {
      console.error("[evalbench] failed to record span", span.spanId, err);
    }
  }

  /**
   * All spans of a trace, oldest first, metadata only (no raw content).
   * Subscribe to this to render a trace as a live span tree that fills in
   * as spans are recorded; build the tree from each span's `parentSpanId`.
   */
  async spansByTrace(ctx: RunQueryCtx, traceId: string) {
    return await ctx.runQuery(this.component.queries.spansByTrace, {
      traceId,
    });
  }

  /**
   * Recent traces: root spans (those without a `parentSpanId`) newest
   * first, limited to `limit` (default 50, capped at 200).
   */
  async recentTraces(ctx: RunQueryCtx, args: { limit?: number } = {}) {
    return await ctx.runQuery(this.component.queries.recentTraces, args);
  }

  /**
   * Resolve a span's recorded content on demand: inline content directly,
   * plus signed URLs for content held in File Storage. `spanId` is the
   * span document id surfaced by `spansByTrace`.
   */
  async spanContent(ctx: RunQueryCtx, spanId: string) {
    return await ctx.runQuery(this.component.queries.spanContent, {
      spanId,
    });
  }
}

export default Evalbench;
