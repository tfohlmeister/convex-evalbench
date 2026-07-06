/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dashboard is a standalone workspace app developed against the
// `example/` Convex deployment. `envDir: ".."` reads the repo-root
// `.env.local` so `VITE_CONVEX_URL` is shared with the backend tooling,
// and `fs.allow: [".."]` lets the module graph import the example's
// generated `api` from outside this package's root.
export default defineConfig({
  envDir: "..",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    fs: { allow: [".."] },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: true,
  },
});
