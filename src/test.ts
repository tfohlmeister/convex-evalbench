/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

import schema from "./component/schema.js";
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the evalbench component with a `convex-test` host so the
 * component's tables and functions are available to the test.
 *
 * ```ts
 * import { convexTest } from "convex-test";
 * import { register } from "convex-evalbench/test";
 *
 * const t = convexTest(hostSchema, hostModules);
 * register(t);
 * ```
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "evalbench",
): void {
  t.registerComponent(name, schema, modules);
}

export default { register, schema, modules };
