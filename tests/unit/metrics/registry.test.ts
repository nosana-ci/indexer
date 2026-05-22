import { describe, it, expect } from "vitest";
import { createRegistry, SERVICE_NAME } from "../../../src/metrics/registry";

describe("createRegistry", () => {
  it("includes the service constant label in scraped output", async () => {
    const { registry } = createRegistry("api");
    const output = await registry.metrics();
    expect(output).toContain(`service="${SERVICE_NAME}"`);
  });

  it("includes the app_mode constant label matching the mode argument", async () => {
    const { registry } = createRegistry("api");
    const output = await registry.metrics();
    expect(output).toContain(`app_mode="api"`);
  });

  it("includes a different app_mode when constructed with indexer mode", async () => {
    const { registry } = createRegistry("indexer");
    const output = await registry.metrics();
    expect(output).toContain(`app_mode="indexer"`);
  });

  it("includes default process metrics (collectDefaultMetrics is wired)", async () => {
    const { registry } = createRegistry("api");
    const output = await registry.metrics();
    expect(output).toContain("process_cpu_user_seconds_total");
  });

  it("exposes http_requests_total counter with the correct label names", async () => {
    const { registry, http } = createRegistry("api");
    http.requestsTotal.labels("GET", "/health", "2xx").inc();
    const output = await registry.metrics();
    expect(output).toContain("http_requests_total");
    expect(output).toContain(`method="GET"`);
  });

  it("creates independent registries that do not share metric state", async () => {
    const first = createRegistry("api");
    const second = createRegistry("cron");
    first.http.requestsTotal.labels("GET", "/x", "2xx").inc();
    const secondOutput = await second.registry.metrics();
    expect(secondOutput).not.toMatch(/http_requests_total{[^}]*} 1/);
  });
});
