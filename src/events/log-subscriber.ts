import { type NosanaClient } from "@nosana/kit";
import { type Address } from "@solana/kit";
import ProgramTransactionsRepository from "../repositories/program-transactions.repository";
import { PROGRAM_TX_STATUS } from "../db/tables/program-transactions";
import type { EventMetrics } from "../metrics/events";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "log-subscriber" });

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

/**
 * Low-latency ingestion: subscribes to the Nosana Jobs program's logs and
 * records each transaction signature into `program_transactions` as it lands,
 * instead of waiting for the next poll cycle. Reconnects indefinitely with
 * exponential backoff — it never fatals, because the periodic
 * getSignaturesForAddress poll is the reliable source of truth and fills any
 * gap this subscription drops. The subscription carries no blockTime; the
 * processor derives that from getTransaction when decoding.
 */
export class ProgramLogSubscriber {
  private readonly nosanaClient: NosanaClient;
  private readonly repo: ProgramTransactionsRepository;
  private readonly programAddress: Address;
  private readonly metrics?: EventMetrics;

  private running = false;
  private abortController: AbortController | null = null;
  private reconnectAttempts = 0;

  constructor(
    nosanaClient: NosanaClient,
    opts: { repo?: ProgramTransactionsRepository; metrics?: EventMetrics } = {},
  ) {
    this.nosanaClient = nosanaClient;
    this.repo = opts.repo || new ProgramTransactionsRepository();
    this.programAddress = nosanaClient.config.programs.jobsAddress;
    this.metrics = opts.metrics;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.subscribe();
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  private async subscribe(): Promise<void> {
    if (!this.running) return;
    this.abortController = new AbortController();

    try {
      const notifications = await this.nosanaClient.solana.rpcSubscriptions
        .logsNotifications({ mentions: [this.programAddress] }, { commitment: "confirmed" })
        .subscribe({ abortSignal: this.abortController.signal });

      logger.info("Program logs subscription connected");
      this.reconnectAttempts = 0;
      this.metrics?.setLogsConnected(true);

      for await (const notification of notifications) {
        const { context, value } = notification;
        try {
          const failed = value.err != null;
          const inserted = await this.repo.insertMany([
            {
              signature: value.signature,
              slot: Number(context.slot),
              blockTime: null,
              failed,
              status: failed ? PROGRAM_TX_STATUS.ARCHIVED : PROGRAM_TX_STATUS.PENDING,
            },
          ]);
          this.metrics?.recordIngested("logs", inserted);
        } catch (error) {
          logger.error(
            { err: error, signature: value.signature },
            "Failed to store program log signature",
          );
        }
      }

      if (this.running) {
        logger.warn("Program logs stream ended");
        this.metrics?.setLogsConnected(false);
        this.reconnect();
      }
    } catch (error) {
      if (this.running) {
        logger.error({ err: error }, "Program logs subscription error");
        this.metrics?.setLogsConnected(false);
        this.reconnect();
      }
    }
  }

  private reconnect(): void {
    if (!this.running) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS,
    );
    logger.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      "Reconnecting program logs subscription",
    );
    setTimeout(() => {
      if (this.running) void this.subscribe();
    }, delay);
  }
}
