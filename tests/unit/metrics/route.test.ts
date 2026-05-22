import { describe, it, expect } from "vitest";
import { Elysia } from "elysia";
import { createRegistry } from "../../../src/metrics/registry";
import { metricsRoute, METRICS_ROUTE, METRICS_CONTENT_TYPE_PREFIX } from "../../../src/metrics/route";
import { httpElysiaPlugin } from "../../../src/metrics/http-elysia";

describe("metricsRoute", () => {
  it("responds with 200 when GET /metrics is hit", async () => {
    const handle = createRegistry("api");
    const app = new Elysia().use(metricsRoute(handle));

    const response = await app.handle(new Request(`http://localhost${METRICS_ROUTE}`));
    expect(response.status).toBe(200);
  });

  it("responds with the Prometheus text content type", async () => {
    const handle = createRegistry("api");
    const app = new Elysia().use(metricsRoute(handle));

    const response = await app.handle(new Request(`http://localhost${METRICS_ROUTE}`));
    expect(response.headers.get("content-type")).toContain(METRICS_CONTENT_TYPE_PREFIX);
  });

  it("exposes the metrics body from the registry", async () => {
    const handle = createRegistry("api");
    handle.http.requestsTotal.labels("GET", "/test", "2xx").inc();

    const app = new Elysia().use(metricsRoute(handle));
    const response = await app.handle(new Request(`http://localhost${METRICS_ROUTE}`));
    const body = await response.text();

    expect(body).toContain("http_requests_total");
  });

  it("does not increment http_requests_total when /metrics is hit", async () => {
    const handle = createRegistry("api");
    const app = new Elysia()
      .use(httpElysiaPlugin(handle))
      .use(metricsRoute(handle));

    await app.handle(new Request(`http://localhost${METRICS_ROUTE}`));

    const output = await handle.registry.metrics();
    expect(output).not.toMatch(/http_requests_total{[^}]*route="\/metrics"[^}]*}/);
  });
});
