/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    ingestion: {
      recordSpan: FunctionReference<
        "mutation",
        "internal",
        {
          agentName?: string;
          costUsd?: number;
          endedAt?: number;
          errorType?: string;
          inputTokens?: number;
          kind: "llm" | "tool" | "agent_step" | "workflow_step" | "judge";
          latencyMs?: number;
          metadata?: any;
          model?: string;
          operationName: string;
          outputTokens?: number;
          parentSpanId?: string;
          provider?: string;
          runId?: string;
          spanId: string;
          startedAt: number;
          status: "running" | "success" | "error";
          threadId?: string;
          totalTokens?: number;
          traceId: string;
          userId?: string;
        },
        string,
        Name
      >;
      recordSpanWithContent: FunctionReference<
        "action",
        "internal",
        {
          agentName?: string;
          costUsd?: number;
          endedAt?: number;
          errorType?: string;
          input?: string;
          inputTokens?: number;
          kind: "llm" | "tool" | "agent_step" | "workflow_step" | "judge";
          latencyMs?: number;
          metadata?: any;
          model?: string;
          operationName: string;
          output?: string;
          outputTokens?: number;
          parentSpanId?: string;
          provider?: string;
          runId?: string;
          spanId: string;
          startedAt: number;
          status: "running" | "success" | "error";
          threadId?: string;
          totalTokens?: number;
          traceId: string;
          userId?: string;
        },
        string,
        Name
      >;
    };
    queries: {
      recentTraces: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          agentName?: string;
          contentRecorded?: boolean;
          costUsd?: number;
          endedAt?: number;
          errorType?: string;
          inputTokens?: number;
          kind: "llm" | "tool" | "agent_step" | "workflow_step" | "judge";
          latencyMs?: number;
          metadata?: any;
          model?: string;
          operationName: string;
          outputTokens?: number;
          parentSpanId?: string;
          provider?: string;
          runId?: string;
          spanId: string;
          startedAt: number;
          status: "running" | "success" | "error";
          threadId?: string;
          totalTokens?: number;
          traceId: string;
          userId?: string;
        }>,
        Name
      >;
      spanContent: FunctionReference<
        "query",
        "internal",
        { spanId: string },
        {
          input?: string;
          inputUrl?: string | null;
          output?: string;
          outputUrl?: string | null;
        },
        Name
      >;
      spansByTrace: FunctionReference<
        "query",
        "internal",
        { traceId: string },
        Array<{
          _creationTime: number;
          _id: string;
          agentName?: string;
          contentRecorded?: boolean;
          costUsd?: number;
          endedAt?: number;
          errorType?: string;
          inputTokens?: number;
          kind: "llm" | "tool" | "agent_step" | "workflow_step" | "judge";
          latencyMs?: number;
          metadata?: any;
          model?: string;
          operationName: string;
          outputTokens?: number;
          parentSpanId?: string;
          provider?: string;
          runId?: string;
          spanId: string;
          startedAt: number;
          status: "running" | "success" | "error";
          threadId?: string;
          totalTokens?: number;
          traceId: string;
          userId?: string;
        }>,
        Name
      >;
    };
  };
