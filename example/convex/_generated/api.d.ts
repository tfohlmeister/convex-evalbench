/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentDemo from "../agentDemo.js";
import type * as dashboard from "../dashboard.js";
import type * as demo from "../demo.js";
import type * as evalDemo from "../evalDemo.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentDemo: typeof agentDemo;
  dashboard: typeof dashboard;
  demo: typeof demo;
  evalDemo: typeof evalDemo;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  evalbench: import("convex-evalbench/_generated/component.js").ComponentApi<"evalbench">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
