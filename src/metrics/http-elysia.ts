import { Elysia } from "elysia";
import type { RegistryHandle } from "./registry";
import { extractRoutePattern, statusRange } from "./labels";
import { METRICS_ROUTE } from "./route";

const STATUS_MAP: Record<string, number> = {
  OK: 200,
  Created: 201,
  Accepted: 202,
  "No Content": 204,
  "Bad Request": 400,
  Unauthorized: 401,
  Forbidden: 403,
  "Not Found": 404,
  "Method Not Allowed": 405,
  "Internal Server Error": 500,
  "Bad Gateway": 502,
  "Service Unavailable": 503,
};

function resolveStatusCode(set: { status?: number | string }, errorStatus?: number): number {
  if (errorStatus !== undefined) return errorStatus;
  if (!set.status) return 200;
  if (typeof set.status === "number") return set.status;
  const parsed = parseInt(set.status, 10);
  if (!isNaN(parsed)) return parsed;
  return STATUS_MAP[set.status] ?? 200;
}

function recordRequest(
  request: Request,
  set: { status?: number | string; headers: Record<string, string> },
  handle: RegistryHandle,
  route: string,
  errorStatus?: number,
): void {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname.startsWith(METRICS_ROUTE)) return;

  const startTimeStr = set.headers["x-request-start-time"];
  if (!startTimeStr) return;

  const startTime = parseInt(startTimeStr, 10);
  const durationSeconds = (Date.now() - startTime) / 1000;

  const routeLabel = route || extractRoutePattern(pathname);
  const code = resolveStatusCode(set, errorStatus);

  handle.http.requestsTotal.labels(request.method, routeLabel, statusRange(code)).inc();
  handle.http.requestDuration.labels(request.method, routeLabel).observe(durationSeconds);

  delete set.headers["x-request-start-time"];
}

/**
 * Elysia plugin (function-style for correct lifecycle propagation in Elysia 1.4)
 * that stamps request start time on onRequest and records HTTP metrics on
 * onAfterHandle / onError. Excludes /metrics from instrumentation.
 *
 * Prefers Elysia's matched route template (Context.route, e.g. "/items/:slug")
 * over regex-based pattern extraction so the `route` label is bounded by the
 * number of registered routes rather than by user input. Falls back to
 * extractRoutePattern only for unmatched paths (typically 404s).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function httpElysiaPlugin(handle: RegistryHandle): any {
  return (app: Elysia) =>
    app
      .onRequest(({ request, set }) => {
        const pathname = new URL(request.url).pathname;
        if (pathname.startsWith(METRICS_ROUTE)) return;
        set.headers["x-request-start-time"] = Date.now().toString();
      })
      .onAfterHandle(({ request, set, route }) => {
        recordRequest(
          request,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          set as any,
          handle,
          route,
        );
      })
      .onError(({ request, set, error, route }) => {
        const errorStatusCode =
          error && typeof error === "object" && "status" in error
            ? ((error as { status?: number }).status ?? 500)
            : 500;
        recordRequest(
          request,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          set as any,
          handle,
          route,
          errorStatusCode,
        );
      });
}
