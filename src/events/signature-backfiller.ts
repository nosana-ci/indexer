import { type NosanaClient } from "@nosana/kit";
import { type Address, type Signature } from "@solana/kit";
import ProgramTransactionsRepository from "../repositories/program-transactions.repository";
import AppTasksRepository from "../repositories/app-tasks.repository";
import type { EventMetrics } from "../metrics/events";
import {
  PROGRAM_TX_STATUS,
  DETAIL_LOOKBACK_SECONDS,
  type InsertProgramTransaction,
} from "../db/tables/program-transactions";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "signature-backfiller" });

// Marker recorded once the backfill reaches genesis, so it stops running.
const BACKFILL_TASK_ID = "program-signatures-backfill";
const PAGE_SIZE = 1000;
// Pages ingested per run; the cron drives this repeatedly and resumes from the
// oldest stored signature, so the whole history is walked over many runs.
const MAX_PAGES_PER_RUN = 10;

/**
 * Walks the Nosana Jobs program's transaction history backwards (via the
 * `before` cursor from the oldest stored signature) and stores every signature.
 * Signatures older than the detail window are archived as already-processed;
 * recent ones are left pending for the transaction processor to decode.
 * Idempotent and resumable — safe to run repeatedly until it reaches genesis.
 */
export class ProgramSignatureBackfiller {
  private readonly nosanaClient: NosanaClient;
  private readonly repo: ProgramTransactionsRepository;
  private readonly appTasksRepo: AppTasksRepository;
  private readonly programAddress: Address;
  private readonly metrics?: EventMetrics;
  private readonly now: () => number;

  constructor(
    nosanaClient: NosanaClient,
    opts: {
      repo?: ProgramTransactionsRepository;
      appTasksRepo?: AppTasksRepository;
      metrics?: EventMetrics;
      now?: () => number;
    } = {},
  ) {
    this.nosanaClient = nosanaClient;
    this.repo = opts.repo || new ProgramTransactionsRepository();
    this.appTasksRepo = opts.appTasksRepo || new AppTasksRepository();
    this.programAddress = nosanaClient.config.programs.jobsAddress;
    this.metrics = opts.metrics;
    this.now = opts.now || (() => Math.floor(Date.now() / 1000));
  }

  /** Ingests up to `maxPages` older pages. Returns inserted count and whether genesis was reached. */
  async backfill(
    maxPages = MAX_PAGES_PER_RUN,
  ): Promise<{ inserted: number; reachedGenesis: boolean }> {
    // Once the whole history has been walked, this is a no-op (a cheap DB read,
    // no RPC) — the cron keeps firing but does nothing.
    if (await this.appTasksRepo.isComplete(BACKFILL_TASK_ID)) {
      return { inserted: 0, reachedGenesis: true };
    }

    let before = await this.repo.getOldestSignature();
    const cutoff = this.now() - DETAIL_LOOKBACK_SECONDS;
    let inserted = 0;
    let reachedGenesis = false;

    for (let page = 0; page < maxPages; page++) {
      const signatures = await this.nosanaClient.solana.rpc
        .getSignaturesForAddress(this.programAddress, {
          limit: PAGE_SIZE,
          ...(before ? { before: before as Signature } : {}),
        })
        .send();

      if (signatures.length === 0) {
        reachedGenesis = true;
        break;
      }

      const rows: InsertProgramTransaction[] = signatures.map((s) => {
        const blockTime = s.blockTime != null ? Number(s.blockTime) : null;
        const failed = s.err != null;
        // Archive failed txs and anything older than the detail window so they
        // are stored but never decoded; recent successful txs stay pending.
        // A null blockTime means the node no longer knows when the block was —
        // treat that as beyond the decode window too, rather than queueing a
        // signature getTransaction will not serve either.
        const archived = failed || blockTime == null || blockTime < cutoff;
        return {
          signature: s.signature,
          slot: Number(s.slot),
          blockTime,
          failed,
          status: archived ? PROGRAM_TX_STATUS.ARCHIVED : PROGRAM_TX_STATUS.PENDING,
        };
      });

      const added = await this.repo.insertMany(rows);
      inserted += added;
      this.metrics?.recordIngested("backfill", added);
      before = signatures[signatures.length - 1].signature;

      if (signatures.length < PAGE_SIZE) {
        reachedGenesis = true;
        break;
      }
    }

    if (reachedGenesis) {
      await this.appTasksRepo.markComplete(BACKFILL_TASK_ID);
    }
    if (inserted > 0 || reachedGenesis) {
      logger.info({ inserted, reachedGenesis }, "Backfilled program signatures");
    }
    return { inserted, reachedGenesis };
  }
}
