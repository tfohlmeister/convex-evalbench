import { Evalbench } from "convex-evalbench";
import { otlpTraceHandler } from "convex-evalbench/otlp";
import { httpRouter } from "convex/server";

import { components } from "./_generated/api.js";
import { httpAction } from "./_generated/server.js";

const evalbench = new Evalbench(components.evalbench);

/**
 * Mount the OTLP trace receiver. Point any OpenTelemetry exporter at
 * `<deployment>.convex.site/v1/traces` with `http/json`. In production,
 * guard the route with an `authorize` hook (a shared secret or bearer
 * check); it is open here for the local example.
 */
const http = httpRouter();

http.route({
  path: "/v1/traces",
  method: "POST",
  handler: httpAction(otlpTraceHandler({ evalbench, recordContent: true })),
});

export default http;
