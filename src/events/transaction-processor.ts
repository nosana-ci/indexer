import { type NosanaClient } from "@nosana/kit";
import { type Signature } from "@solana/kit";
import { JobEventDecoder } from "./decoder";
import ProgramTransactionsRepository from "../repositories/program-transactions.repository";
import ProgramEventsRepository from "../repositories/program-events.repository";
import type { SelectProgramTransaction } from "../db/tables/program-transactions";
import type { InsertProgramEvent } from "../db/tables/program-events";
import type { EventMetrics } from "../metrics/events";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "transaction-processor" });

const DEFAULT_BATCH = 200;
const CONCURRENCY = 5;

/**
 * Drains the `program_transactions` queue: fetches each pending transaction,
 * decodes its Nosana Jobs instructions into `program_events`, and marks it
 * processed. Idempotent — safe to re-run; unfetchable transactions are left
 * pending for the next pass.
 */
export class TransactionProcessor {
  private readonly nosanaClient: NosanaClient;
  private readonly decoder: JobEventDecoder;
  private readonly programTxRepo: ProgramTransactionsRepository;
  private readonly eventsRepo: ProgramEventsRepository;
  private readonly metrics?: EventMetrics;

  constructor(
    nosanaClient: NosanaClient,
    opts: {
      decoder?: JobEventDecoder;
      programTxRepo?: ProgramTransactionsRepository;
      eventsRepo?: ProgramEventsRepository;
      metrics?: EventMetrics;
    } = {},
  ) {
    this.nosanaClient = nosanaClient;
    this.decoder = opts.decoder || new JobEventDecoder(nosanaClient);
    this.programTxRepo = opts.programTxRepo || new ProgramTransactionsRepository();
    this.eventsRepo = opts.eventsRepo || new ProgramEventsRepository();
    this.metrics = opts.metrics;
  }

  async process(limit = DEFAULT_BATCH): Promise<{ processed: number; events: number }> {
    const rows = await this.programTxRepo.claimUnprocessed(limit);
    if (!rows.length) {
      this.metrics?.setPending(0);
      return { processed: 0, events: 0 };
    }

    const succeeded: string[] = [];
    const failed: string[] = [];
    let events = 0;

    await this.mapWithConcurrency(rows, async (row) => {
      try {
        const inserted = await this.processOne(row);
        if (inserted === null) {
          // Not available from the RPC (yet, or ever) — retry on a later pass,
          // but count the attempt so it can eventually be parked.
          failed.push(row.signature);
          return;
        }
        succeeded.push(row.signature);
        events += inserted;
      } catch (error) {
        failed.push(row.signature);
        this.metrics?.recordProcessError();
        logger.error({ err: error, signature: row.signature }, "Failed to process transaction");
      }
    });

    await this.programTxRepo.markProcessed(succeeded);
    const parked = await this.programTxRepo.recordFailedAttempts(failed);
    if (parked > 0) {
      logger.warn({ parked }, "Parked transactions the RPC could not serve");
    }

    // Late-fill job/node for pickups whose run account had already closed. Runs
    // close as soon as a job ends, so this is the normal path for anything
    // decoded from the backfill rather than live.
    if (events > 0) {
      const resolved = await this.eventsRepo.resolveRunAttribution();
      if (resolved > 0) logger.info({ resolved }, "Resolved run attribution for events");
    }
    this.metrics?.recordProcessed(succeeded.length, events);
    // Remaining pending after this pass (0 if we drained the batch below the limit).
    this.metrics?.setPending(await this.programTxRepo.countPending());
    if (succeeded.length) {
      logger.info({ processed: succeeded.length, events }, "Processed program transactions");
    }
    return { processed: succeeded.length, events };
  }

  /** Returns inserted event count, or null if the transaction isn't available yet. */
  private async processOne(row: SelectProgramTransaction): Promise<number | null> {
    const tx = await this.nosanaClient.solana.rpc
      .getTransaction(row.signature as Signature, {
        maxSupportedTransactionVersion: 0,
        encoding: "jsonParsed",
        commitment: "confirmed",
      })
      .send();

    if (!tx) return null;

    // Prefer the slot/blockTime from the fetched transaction — the queue row's
    // blockTime is null when the signature was ingested from the logs stream
    // (which doesn't include it), whereas getTransaction always provides both.
    const txMeta = tx as { slot?: number | bigint; blockTime?: number | bigint | null };
    const slot = txMeta.slot != null ? Number(txMeta.slot) : row.slot;
    const blockTime = txMeta.blockTime != null ? Number(txMeta.blockTime) : row.blockTime;

    // Decode every Nosana instruction in the tx (job lifecycle, node queue,
    // market ops, …) with the job/node/market it references.
    const decoded = await this.decoder.decode(tx);
    if (decoded.length === 0) return 0;

    const events: InsertProgramEvent[] = decoded.map((d) => ({
      signature: row.signature,
      instructionIndex: d.instructionIndex,
      type: d.type,
      jobAddress: d.jobAddress,
      nodeAddress: d.nodeAddress,
      marketAddress: d.marketAddress,
      runAddress: d.runAddress,
      slot,
      blockTime,
      data: d.data,
    }));
    return this.eventsRepo.insertMany(events);
  }

  private async mapWithConcurrency<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await fn(item);
      }
    });
    await Promise.all(workers);
  }
}
