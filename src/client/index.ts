import type { ComponentApi } from "../component/_generated/component.js";

export { EVALBENCH_VERSION } from "../shared.js";

/**
 * Host-app handle for the evalbench component.
 *
 * Construct one with the generated `components.evalbench` and use it to
 * record traces, manage datasets, trigger eval runs, and read results.
 * The concrete methods are added per phase (see HANDOVER.md); the
 * foundation only wires up the component handle so the export surface
 * and build pipeline are in place.
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
}

export default Evalbench;
