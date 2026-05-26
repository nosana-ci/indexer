import { describe, it, expect } from "vitest";
import { createRegistry } from "../../../src/metrics/registry";
import {
  makeIndexerMetrics,
  INDEXER_EVENTS_TOTAL,
  INDEXER_EVENT_ERRORS_TOTAL,
  INDEXER_WEBSOCKET_CONNECTED,
  INDEXER_RECONNECT_ATTEMPTS_TOTAL,
} from "../../../src/metrics/indexer";

describe("makeIndexerMetrics", () => {
  it("increments indexer_events_total on a successful event", async () => {
    const handle = createRegistry("indexer");
    const indexerMetrics = makeIndexerMetrics(handle);

    indexerMetrics.recordIndexerEvent("JOB", 0.05, true);

    const output = await handle.registry.metrics();
    expect(output).toContain(`${INDEXER_EVENTS_TOTAL}{`);
    expect(output).toContain(`event_type="JOB"`);
  });

  it("increments indexer_event_errors_total on a failed event", async () => {
    const handle = createRegistry("indexer");
    const indexerMetrics = makeIndexerMetrics(handle);

    indexerMetrics.recordIndexerEvent("RUN", 0.1, false);

    const output = await handle.registry.metrics();
    expect(output).toContain(`${INDEXER_EVENT_ERRORS_TOTAL}{`);
    expect(output).toContain(`event_type="RUN"`);
  });

  it("observes the indexer_event_duration_seconds histogram", async () => {
    const handle = createRegistry("indexer");
    const indexerMetrics = makeIndexerMetrics(handle);

    indexerMetrics.recordIndexerEvent("MARKET", 0.25, true);

    const output = await handle.registry.metrics();
    expect(output).toContain("indexer_event_duration_seconds_count");
    expect(output).toContain(`event_type="MARKET"`);
  });

  it("sets indexer_websocket_connected gauge to 0 when disconnected", async () => {
    const handle = createRegistry("indexer");
    const indexerMetrics = makeIndexerMetrics(handle);

    indexerMetrics.setWebsocketConnected(false);

    const output = await handle.registry.metrics();
    expect(output).toContain(INDEXER_WEBSOCKET_CONNECTED);
    expect(output).toMatch(new RegExp(`${INDEXER_WEBSOCKET_CONNECTED}{[^}]*} 0`));
  });

  it("sets indexer_websocket_connected gauge to 1 when connected", async () => {
    const handle = createRegistry("indexer");
    const indexerMetrics = makeIndexerMetrics(handle);

    indexerMetrics.setWebsocketConnected(true);

    const output = await handle.registry.metrics();
    expect(output).toMatch(new RegExp(`${INDEXER_WEBSOCKET_CONNECTED}{[^}]*} 1`));
  });

  it("increments indexer_reconnect_attempts_total with the given reason", async () => {
    const handle = createRegistry("indexer");
    const indexerMetrics = makeIndexerMetrics(handle);

    indexerMetrics.recordReconnect("error", 1);

    const output = await handle.registry.metrics();
    expect(output).toContain(`${INDEXER_RECONNECT_ATTEMPTS_TOTAL}{`);
    expect(output).toContain(`reason="error"`);
  });

  it("updates indexer_last_activity_timestamp_seconds on markActivity", async () => {
    const handle = createRegistry("indexer");
    const indexerMetrics = makeIndexerMetrics(handle);
    const before = Math.floor(Date.now() / 1000);

    indexerMetrics.markActivity();

    const output = await handle.registry.metrics();
    expect(output).toContain("indexer_last_activity_timestamp_seconds");
    const match = output.match(/indexer_last_activity_timestamp_seconds{[^}]*} (\d+)/);
    expect(match).not.toBeNull();
    const recorded = parseInt(match![1], 10);
    expect(recorded).toBeGreaterThanOrEqual(before);
  });
});
