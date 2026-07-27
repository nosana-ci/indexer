import { Counter, Gauge } from "prom-client";
import type { RegistryHandle } from "./registry";

export const JOB_EVENT_SIGNATURES_INGESTED_TOTAL = "job_event_signatures_ingested_total";
export const JOB_EVENT_TRANSACTIONS_PROCESSED_TOTAL = "job_event_transactions_processed_total";
export const JOB_EVENTS_INSERTED_TOTAL = "job_events_inserted_total";
export const JOB_EVENT_PROCESS_ERRORS_TOTAL = "job_event_process_errors_total";
export const JOB_EVENT_PENDING_TRANSACTIONS = "job_event_pending_transactions";
export const JOB_EVENT_LOGS_CONNECTED = "job_event_logs_connected";

/** Where an ingested signature came from. */
export type IngestSource = "logs" | "poll" | "backfill";

export interface EventMetrics {
  /** New signatures stored, labelled by ingestion path. */
  recordIngested(source: IngestSource, count: number): void;
  /** A completed processor pass: transactions decoded and job events inserted. */
  recordProcessed(transactions: number, events: number): void;
  /** A transaction that failed to process (decode/RPC error). */
  recordProcessError(): void;
  /** Current pending (undecoded) queue depth — backlog / backfill progress. */
  setPending(count: number): void;
  /** Whether the program logs subscription is currently connected. */
  setLogsConnected(connected: boolean): void;
}

export function makeEventMetrics(handle: RegistryHandle): EventMetrics {
  const signaturesIngested = new Counter({
    name: JOB_EVENT_SIGNATURES_INGESTED_TOTAL,
    help: "Total program transaction signatures ingested, by source",
    labelNames: ["source"] as const,
    registers: [handle.registry],
  });

  const transactionsProcessed = new Counter({
    name: JOB_EVENT_TRANSACTIONS_PROCESSED_TOTAL,
    help: "Total program transactions decoded by the processor",
    registers: [handle.registry],
  });

  const eventsInserted = new Counter({
    name: JOB_EVENTS_INSERTED_TOTAL,
    help: "Total job events inserted",
    registers: [handle.registry],
  });

  const processErrors = new Counter({
    name: JOB_EVENT_PROCESS_ERRORS_TOTAL,
    help: "Total transactions that failed to process",
    registers: [handle.registry],
  });

  const pending = new Gauge({
    name: JOB_EVENT_PENDING_TRANSACTIONS,
    help: "Program transactions pending decoding",
    registers: [handle.registry],
  });

  const logsConnected = new Gauge({
    name: JOB_EVENT_LOGS_CONNECTED,
    help: "Whether the program logs subscription is connected (1) or not (0)",
    registers: [handle.registry],
  });

  return {
    recordIngested(source, count) {
      if (count > 0) signaturesIngested.labels(source).inc(count);
    },
    recordProcessed(transactions, events) {
      if (transactions > 0) transactionsProcessed.inc(transactions);
      if (events > 0) eventsInserted.inc(events);
    },
    recordProcessError() {
      processErrors.inc();
    },
    setPending(count) {
      pending.set(count);
    },
    setLogsConnected(connected) {
      logsConnected.set(connected ? 1 : 0);
    },
  };
}
