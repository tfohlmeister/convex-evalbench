import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    exclude: ["**/node_modules/**", "dist/**"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
