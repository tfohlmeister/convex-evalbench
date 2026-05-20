import { defineApp } from "convex/server";
import evalbench from "convex-evalbench/convex.config";

const app = defineApp();
app.use(evalbench);

export default app;
