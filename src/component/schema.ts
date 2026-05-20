import { defineSchema } from "convex/server";

/**
 * Component storage schema.
 *
 * Intentionally empty in the foundation cut. The trace/span, dataset,
 * run, and result tables are added per phase during OpenSpec planning
 * (see HANDOVER.md, "Data model"). Keeping it empty here lets the build
 * and codegen pipeline stay green without committing a data model that
 * has not been designed yet.
 */
export default defineSchema({});
