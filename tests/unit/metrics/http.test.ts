import { describe, it, expect } from "vitest";
import { Elysia } from "elysia";
import { createRegistry } from "../../../src/metrics/registry";
import { httpElysiaPlugin } from "../../../src/metrics/http-elysia";
import { METRICS_ROUTE } from "../../../src/metrics/route";

describe("httpElysiaPlugin", () => {
  it("records http_requests_total after a GET request", async () => {
    const handle = createRegistry("api");
    const app = new Elysia()
      .use(httpElysiaPlugin(handle))
      .get("/x/:id", () => "ok");

    await app.handle(new Request("http://localhost/x/123"));

    const output = await handle.registry.metrics();
    expect(output).toContain("http_requests_total");
    expect(output).toContain(`method="GET"`);
    expect(output).toContain(`route="/x/:id"`);
    expect(output).toContain(`status_range="2xx"`);
  });

  it("records http_request_duration_seconds after a request", async () => {
    const handle = createRegistry("api");
    const app = new Elysia()
      .use(httpElysiaPlugin(handle))
      .get("/ping", () => "pong");

    await app.handle(new Request("http://localhost/ping"));

    const output = await handle.registry.metrics();
    expect(output).toContain("http_request_duration_seconds_count");
    expect(output).toMatch(/http_request_duration_seconds_count{[^}]*} 1/);
  });

  it("does not increment http_requests_total for requests to /metrics", async () => {
    const handle = createRegistry("api");
    const app = new Elysia()
      .use(httpElysiaPlugin(handle))
      .get(METRICS_ROUTE, async () => handle.registry.metrics());

    await app.handle(new Request(`http://localhost${METRICS_ROUTE}`));

    const output = await handle.registry.metrics();
    expect(output).not.toMatch(/http_requests_total{[^}]*route="\/metrics"[^}]*}/);
  });

  it("records 4xx status range for not-found routes", async () => {
    const handle = createRegistry("api");
    const app = new Elysia().use(httpElysiaPlugin(handle));

    await app.handle(new Request("http://localhost/no-such-route"));

    const output = await handle.registry.metrics();
    expect(output).toContain(`status_range="4xx"`);
  });

  it("uses Elysia's matched route template for params that aren't IDs/pubkeys/tokens", async () => {
    const handle = createRegistry("api");
    const app = new Elysia()
      .use(httpElysiaPlugin(handle))
      .get("/items/:slug", () => "ok");

    await app.handle(new Request("http://localhost/items/some-arbitrary-name"));

    const output = await handle.registry.metrics();
    expect(output).toContain(`route="/items/:slug"`);
    expect(output).not.toContain(`route="/items/some-arbitrary-name"`);
  });
});
