import { Elysia } from "elysia";
import type { RegistryHandle } from "./registry";

export const METRICS_ROUTE = "/metrics";
export const METRICS_CONTENT_TYPE_PREFIX = "text/plain";

/**
 * Mounts GET /metrics returning the Prometheus text format from the registry.
 * Excluded from HTTP instrumentation — the plugin checks METRICS_ROUTE.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function metricsRoute(handle: RegistryHandle): any {
  return new Elysia().get(METRICS_ROUTE, async ({ set }) => {
    set.headers["content-type"] = handle.registry.contentType;
    return handle.registry.metrics();
  });
}
