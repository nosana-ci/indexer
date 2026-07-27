import { bigint, boolean, index, integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// A base58 Solana transaction signature is at most 88 characters.
const MAX_SIGNATURE_LENGTH = 128;

/** Lifecycle of a signature in the ingestion queue. */
export const PROGRAM_TX_STATUS = {
  /** Awaiting decoding by the transaction processor. */
  PENDING: "pending",
  /** Fetched and decoded into program_events. */
  PROCESSED: "processed",
  /** Intentionally not decoded — older than the detail window, or a failed tx. */
  ARCHIVED: "archived",
  /** Give-up state: still unfetchable after MAX_DECODE_ATTEMPTS passes. */
  UNAVAILABLE: "unavailable",
} as const;

/**
 * How many times the processor will try to fetch a signature before parking it
 * as `unavailable`. Without this a signature the RPC cannot serve — pruned
 * history, or a `confirmed` transaction dropped in a fork — stays pending at
 * the head of the oldest-slot-first queue forever and starves every newer
 * transaction behind it.
 */
export const MAX_DECODE_ATTEMPTS = 5;

/**
 * Only transactions from this window are decoded into events. Older signatures
 * are still stored (a complete hash archive) but ingested `archived` so the
 * processor never fetches them. Applied by every ingest path — RPC providers
 * typically serve `getTransaction` for far less history than this, so queueing
 * older signatures as pending just fills the queue with unservable work.
 */
export const DETAIL_LOOKBACK_SECONDS = 14 * 24 * 60 * 60;

export type ProgramTxStatus = (typeof PROGRAM_TX_STATUS)[keyof typeof PROGRAM_TX_STATUS];

/**
 * Durable ingestion log of every transaction that touched the Nosana Jobs
 * program, populated from the program's signature stream (logs subscription +
 * getSignaturesForAddress poll + historical backfill). This is the work queue
 * for the transaction processor: `pending` rows are decoded and become
 * `processed`; rows outside the decode window (or failed on-chain) are stored
 * `archived` so the full history is retained without being decoded.
 */
export const programTransactions = pgTable(
  "program_transactions",
  {
    id: serial("id").primaryKey(),
    signature: varchar("signature", { length: MAX_SIGNATURE_LENGTH }).notNull().unique(),
    slot: bigint("slot", { mode: "number" }).notNull(),
    blockTime: integer("block_time"),
    // Whether the transaction failed on-chain (err != null). Informational;
    // failed txs are ingested as `archived` and never decoded.
    failed: boolean("failed").notNull().default(false),
    status: varchar("status", { length: 16 }).notNull().default(PROGRAM_TX_STATUS.PENDING),
    // Failed fetch/decode passes, so an unservable signature can be parked
    // instead of blocking the queue behind it.
    attempts: integer("attempts").notNull().default(0),
    processedAt: integer("processed_at"),
  },
  (table) => ({
    // Partial index backing the processor's claim query (pending rows, oldest
    // slot first). Keeps the queue scan cheap as the table grows unbounded.
    pendingIdx: index("idx_program_tx_pending")
      .on(table.slot)
      .where(sql`${table.status} = 'pending'`),
    // Serves the backfill's getOldestSignature(). The partial index above can't:
    // that query is unfiltered, so without this it seq-scans the whole table
    // once a minute for the entire multi-day duration of the backfill.
    slotIdx: index("idx_program_tx_slot").on(table.slot, table.id),
  }),
);

export type InsertProgramTransaction = typeof programTransactions.$inferInsert;
export type SelectProgramTransaction = typeof programTransactions.$inferSelect;
