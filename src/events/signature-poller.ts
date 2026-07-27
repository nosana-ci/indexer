import { type NosanaClient } from "@nosana/kit";
import { type Address, type Signature } from "@solana/kit";
import ProgramTransactionsRepository from "../repositories/program-transactions.repository";
import IndexerCursorsRepository from "../repositories/indexer-cursors.repository";
import type { EventMetrics } from "../metrics/events";
import {
  PROGRAM_TX_STATUS,
  DETAIL_LOOKBACK_SECONDS,
  type InsertProgramTransaction,
} from "../db/tables/program-transactions";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "signature-poller" });

// getSignaturesForAddress returns at most 1000 signatures per call.
const PAGE_SIZE = 1000;
// Safety cap on pages per go-forward poll so an unexpectedly large gap can't
// spin forever; the descent resumes where it stopped on the next poll.
const MAX_PAGES_PER_POLL = 20;

/**
 * Newest signature the poll has confirmed contiguous coverage up to — everything
 * above it has been walked by a completed descent.
 */
const WATERMARK_CURSOR = "program-signatures-poll";
/** Tip a descent started from, kept while that descent is still in progress. */
const DESCENT_TIP_CURSOR = "program-signatures-poll-tip";
/** How far down an interrupted descent got, so the next poll resumes there. */
const DESCENT_BEFORE_CURSOR = "program-signatures-poll-before";

/**
 * Ingests Nosana Jobs program transaction signatures into `program_transactions`,
 * going forward only. Each poll descends from the chain tip back to the poll's
 * own watermark, so it captures every transaction that landed since the last
 * completed descent. With no watermark it seeds from the most recent page only —
 * full-history ingestion is the separate backfill task, not this poll.
 *
 * The watermark lives in `indexer_cursors`, deliberately not derived from the
 * newest row of `program_transactions`: the logs subscription writes to that
 * table too, so after any downtime its first live signature would look like a
 * caught-up cursor and the whole outage window would be skipped.
 *
 * A descent that exceeds the page cap records where it stopped and continues
 * from there next poll, so a gap wider than one poll still closes instead of
 * re-walking the same pages forever. The watermark advances only once a descent
 * reaches it, so an interrupted poll never claims coverage it does not have.
 */
export class ProgramSignaturePoller {
  private readonly nosanaClient: NosanaClient;
  private readonly repo: ProgramTransactionsRepository;
  private readonly cursors: IndexerCursorsRepository;
  private readonly programAddress: Address;
  private readonly metrics?: EventMetrics;
  private readonly now: () => number;

  constructor(
    nosanaClient: NosanaClient,
    opts: {
      repo?: ProgramTransactionsRepository;
      cursors?: IndexerCursorsRepository;
      metrics?: EventMetrics;
      now?: () => number;
    } = {},
  ) {
    this.nosanaClient = nosanaClient;
    this.repo = opts.repo || new ProgramTransactionsRepository();
    this.cursors = opts.cursors || new IndexerCursorsRepository();
    this.programAddress = nosanaClient.config.programs.jobsAddress;
    this.metrics = opts.metrics;
    this.now = opts.now || (() => Math.floor(Date.now() / 1000));
  }

  /** Fetches new signatures since the watermark and stores them. Returns inserted count. */
  async poll(): Promise<number> {
    const watermark = await this.cursors.get(WATERMARK_CURSOR);

    // First run: seed the watermark from the newest page only (no full backfill).
    if (!watermark) return this.seed();

    // Resume an interrupted descent where it stopped, still working toward the
    // tip that descent started from. Anything above that tip is picked up by the
    // next descent, once this one has closed the gap down to the watermark.
    let tip = await this.cursors.get(DESCENT_TIP_CURSOR);
    let before = tip ? await this.cursors.get(DESCENT_BEFORE_CURSOR) : undefined;

    let inserted = 0;
    let reachedWatermark = false;

    for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
      const result = await this.insertPage({ limit: PAGE_SIZE, until: watermark, before });
      inserted += result.inserted;
      tip ??= result.firstSignature;

      if (result.fetched < PAGE_SIZE) {
        reachedWatermark = true;
        break;
      }
      before = result.lastSignature;
    }

    if (reachedWatermark) {
      // Clear the descent before promoting the watermark, never the other way
      // round: a crash between the two writes must not leave a watermark at the
      // tip while the resume position still points far below it, which would
      // make every later poll chase an `until` it can never reach from `before`
      // and walk toward genesis instead of ingesting new signatures. In this
      // order a crash just replays the descent, which is idempotent.
      await this.clearDescent();
      // `tip` is unset only when the first page of a fresh descent came back
      // empty — nothing landed since the watermark, so it is already current.
      if (tip) await this.cursors.set(WATERMARK_CURSOR, tip);
    } else if (tip && before) {
      await this.cursors.set(DESCENT_TIP_CURSOR, tip);
      await this.cursors.set(DESCENT_BEFORE_CURSOR, before);
      logger.warn({ tip, before, inserted }, "Poll hit page cap; descent resumes here next run");
    }

    if (inserted > 0) logger.info({ inserted }, "Ingested program transactions");
    return inserted;
  }

  /** Establishes the watermark from the newest page without walking history. */
  private async seed(): Promise<number> {
    const result = await this.insertPage({ limit: PAGE_SIZE });
    if (result.firstSignature) {
      await this.cursors.set(WATERMARK_CURSOR, result.firstSignature);
    }
    logger.info({ inserted: result.inserted }, "Seeded program transaction cursor");
    return result.inserted;
  }

  private async clearDescent(): Promise<void> {
    await this.cursors.clear(DESCENT_TIP_CURSOR);
    await this.cursors.clear(DESCENT_BEFORE_CURSOR);
  }

  private async insertPage(opts: { limit: number; until?: string; before?: string }): Promise<{
    inserted: number;
    fetched: number;
    firstSignature?: string;
    lastSignature?: string;
  }> {
    const signatures = await this.nosanaClient.solana.rpc
      .getSignaturesForAddress(this.programAddress, {
        limit: opts.limit,
        ...(opts.until ? { until: opts.until as Signature } : {}),
        ...(opts.before ? { before: opts.before as Signature } : {}),
      })
      .send();

    if (!signatures.length) return { inserted: 0, fetched: 0 };

    const cutoff = this.now() - DETAIL_LOOKBACK_SECONDS;
    const rows: InsertProgramTransaction[] = signatures.map((s) => {
      const blockTime = s.blockTime != null ? Number(s.blockTime) : null;
      const failed = s.err != null;
      // A descent is usually recent, but not always: after a long outage, or on
      // a first seed of a quiet program, it reaches back past the decode window.
      // Archive those like the backfill does rather than queueing work no RPC
      // will serve. A null blockTime means the node no longer knows when the
      // block was, which is itself a sign it is beyond the window.
      const archived = failed || blockTime == null || blockTime < cutoff;
      return {
        signature: s.signature,
        slot: Number(s.slot),
        blockTime,
        failed,
        status: archived ? PROGRAM_TX_STATUS.ARCHIVED : PROGRAM_TX_STATUS.PENDING,
      };
    });

    const inserted = await this.repo.insertMany(rows);
    this.metrics?.recordIngested("poll", inserted);
    return {
      inserted,
      fetched: signatures.length,
      firstSignature: signatures[0].signature,
      lastSignature: signatures[signatures.length - 1].signature,
    };
  }
}
