import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { createFunctionHandle } from "convex/server";

import type { ComponentApi } from "../component/_generated/component.js";
import type {
  DatasetItemInput,
  RunConfig,
  SpanInput,
  TargetResult,
} from "../shared.js";

export { EVALBENCH_VERSION } from "../shared.js";
export {
  datasetItemInputValidator,
  runConfigValidator,
  runStatusValidator,
  resultStatusValidator,
  scoreRecordValidator,
  scorerConfigValidator,
  spanInputValidator,
  spanKindValidator,
  spanStatusValidator,
  targetResultValidator,
  type DatasetItemInput,
  type ResultStatus,
  type RunConfig,
  type RunStatus,
  type ScoreRecord,
  type ScorerConfig,
  type SpanInput,
  type SpanKind,
  type SpanStatus,
  type TargetResult,
} from "../shared.js";
export {
  exactMatch,
  jsonSchema,
  type ScorerArgs,
  type ScorerVerdict,
} from "../scorers.js";

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
 * The system under test: a host action the runner invokes once per
 * dataset item. It receives the item's `input` plus the `runId` (stamp
 * your spans with it, via the adapter or `recordSpan`, so the run's
 * traces correlate) and the `itemId`; it returns the produced `output`
 * and optionally the `traceId` to open from the result.
 */
export type EvalTarget = FunctionReference<
  "action",
  "internal" | "public",
  { input: unknown; runId: string; itemId: string },
  TargetResult
>;

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

  /**
   * Create a versioned dataset (version 1), optionally with initial
   * items. Returns the dataset id.
   */
  async createDataset(
    ctx: RunMutationCtx,
    args: { name: string; description?: string; items?: DatasetItemInput[] },
  ) {
    return await ctx.runMutation(this.component.datasets.createDataset, args);
  }

  /** Add items to a dataset; its `itemCount` grows by `items.length`. */
  async addItems(
    ctx: RunMutationCtx,
    args: { datasetId: string; items: DatasetItemInput[] },
  ) {
    return await ctx.runMutation(this.component.datasets.addItems, args);
  }

  /** List datasets; archived ones only when `includeArchived` is set. */
  async listDatasets(
    ctx: RunQueryCtx,
    args: { includeArchived?: boolean } = {},
  ) {
    return await ctx.runQuery(this.component.datasets.listDatasets, args);
  }

  /** All items of a dataset. */
  async listItems(ctx: RunQueryCtx, datasetId: string) {
    return await ctx.runQuery(this.component.datasets.listItems, {
      datasetId,
    });
  }

  /**
   * Snapshot a dataset into a new immutable version (next version number
   * for its name, items copied, parent linked). Returns the new id.
   */
  async versionDataset(ctx: RunMutationCtx, datasetId: string) {
    return await ctx.runMutation(this.component.datasets.versionDataset, {
      datasetId,
    });
  }

  /** Archive a dataset; it disappears from the default listing. */
  async archiveDataset(ctx: RunMutationCtx, datasetId: string) {
    return await ctx.runMutation(this.component.datasets.archiveDataset, {
      datasetId,
    });
  }

  /**
   * Start an evaluation run: execute `target` (the system under test)
   * over every item of the dataset with bounded parallelism, score each
   * output with the scorers in `config`, and write one idempotent
   * result per item. A single mutation creates the run and schedules
   * its workers atomically. Returns the run id; subscribe to
   * `runSummary` and `listResults` with it to watch the run fill in
   * live.
   */
  async startRun(
    ctx: RunMutationCtx,
    args: {
      datasetId: string;
      target: EvalTarget;
      config: RunConfig;
      targetVersion?: string;
      targetEnv?: string;
      triggeredBy?: string;
    },
  ) {
    const { target, ...rest } = args;
    const targetHandle = await createFunctionHandle(target);
    return await ctx.runMutation(this.component.runner.startRun, {
      ...rest,
      targetHandle,
    });
  }

  /**
   * The live run summary: one row with maintained counters (total /
   * completed / passed) and the running aggregate score. Reactive; no
   * polling.
   */
  async runSummary(ctx: RunQueryCtx, runId: string) {
    return await ctx.runQuery(this.component.runner.runSummary, { runId });
  }

  /** One result row per item of a run, including scores and trace ids. */
  async listResults(ctx: RunQueryCtx, runId: string) {
    return await ctx.runQuery(this.component.runner.listResults, { runId });
  }
}

export default Evalbench;
