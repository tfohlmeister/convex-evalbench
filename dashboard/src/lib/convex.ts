import { ConvexReactClient } from "convex/react";
// The dashboard is developed against the example deployment. This is the
// one place that reaches into the example's generated api; every view
// imports `api` from here so the cross-package path lives in a single
// file. To target your own deployment, copy `example/convex/dashboard.ts`
// into your `convex/` and repoint this import at your generated api.
import { api } from "../../../example/convex/_generated/api";

export { api };

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!url) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Copy dashboard/.env.example or run the " +
      "example backend (`pnpm local:start`) which writes it to .env.local.",
  );
}

export const convex = new ConvexReactClient(url);
