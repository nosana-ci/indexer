import { Counter, Histogram, Gauge } from "prom-client";
import type { RegistryHandle } from "./registry";

export const INDEXER_EVENTS_TOTAL = "indexer_events_total";
export const INDEXER_EVENT_DURATION_SECONDS = "indexer_event_duration_seconds";
export const INDEXER_EVENT_ERRORS_TOTAL = "indexer_event_errors_total";
export const INDEXER_WEBSOCKET_CONNECTED = "indexer_websocket_connected";
export const INDEXER_RECONNECT_ATTEMPTS_TOTAL = "indexer_reconnect_attempts_total";
export const INDEXER_CURRENT_RECONNECT_ATTEMPT = "indexer_current_reconnect_attempt";
export const INDEXER_LAST_ACTIVITY_TIMESTAMP_SECONDS = "indexer_last_activity_timestamp_seconds";

export type IndexerEventType = "JOB" | "MARKET" | "RUN";
export type ReconnectReason = "stream_ended" | "error" | "max_attempts";

export interface IndexerMetrics {
  recordIndexerEvent(type: IndexerEventType, durationSeconds: number, ok: boolean): void;
  setWebsocketConnected(connected: boolean): void;
  recordReconnect(reason: ReconnectReason | string, attempt: number): void;
  markActivity(): void;
}

export function makeIndexerMetrics(handle: RegistryHandle): IndexerMetrics {
  const eventsTotal = new Counter({
    name: INDEXER_EVENTS_TOTAL,
    help: "Total indexer events processed",
    labelNames: ["event_type"] as const,
    registers: [handle.registry],
  });

  const eventDuration = new Histogram({
    name: INDEXER_EVENT_DURATION_SECONDS,
    help: "Indexer event processing duration in seconds",
    labelNames: ["event_type"] as const,
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [handle.registry],
  });

  const eventErrors = new Counter({
    name: INDEXER_EVENT_ERRORS_TOTAL,
    help: "Total indexer event processing errors",
    labelNames: ["event_type"] as const,
    registers: [handle.registry],
  });

  const wsConnected = new Gauge({
    name: INDEXER_WEBSOCKET_CONNECTED,
    help: "Whether the indexer WebSocket is currently connected (1) or not (0)",
    registers: [handle.registry],
  });

  const reconnectAttempts = new Counter({
    name: INDEXER_RECONNECT_ATTEMPTS_TOTAL,
    help: "Total WebSocket reconnect attempts by reason",
    labelNames: ["reason"] as const,
    registers: [handle.registry],
  });

  const currentReconnectAttempt = new Gauge({
    name: INDEXER_CURRENT_RECONNECT_ATTEMPT,
    help: "Current reconnect attempt number",
    registers: [handle.registry],
  });

  const lastActivityTimestamp = new Gauge({
    name: INDEXER_LAST_ACTIVITY_TIMESTAMP_SECONDS,
    help: "Unix timestamp of the last indexer activity in seconds",
    registers: [handle.registry],
  });

  return {
    recordIndexerEvent(type: IndexerEventType, durationSeconds: number, ok: boolean): void {
      eventsTotal.labels(type).inc();
      eventDuration.labels(type).observe(durationSeconds);
      if (!ok) {
        eventErrors.labels(type).inc();
      }
    },

    setWebsocketConnected(connected: boolean): void {
      wsConnected.set(connected ? 1 : 0);
    },

    recordReconnect(reason: ReconnectReason | string, attempt: number): void {
      reconnectAttempts.labels(reason).inc();
      currentReconnectAttempt.set(attempt);
    },

    markActivity(): void {
      lastActivityTimestamp.set(Math.floor(Date.now() / 1000));
    },
  };
}
