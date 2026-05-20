import agent from "@convex-dev/agent/convex.config";
import { defineApp } from "convex/server";
import evalbench from "convex-evalbench/convex.config";

const app = defineApp();
app.use(evalbench);
// The agent component backs the demo agent wrapped with `withEvalbench`.
app.use(agent);

export default app;
