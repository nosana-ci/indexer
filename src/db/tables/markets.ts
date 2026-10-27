import { bigint, integer, jsonb, pgTable, varchar } from "drizzle-orm/pg-core";
import { MAX_PUBKEY_LENGTH } from "../constants";

/**
 * Current on-chain state of each Nosana market, snapshotted from the market
 * account (via the account monitor + markets GPA) — not the event log, since a
 * queue is live state, not history. `queue` is the market's current queue: node
 * addresses when `queue_type` is NODE_QUEUE (1), or job addresses when
 * JOB_QUEUE (0). Combine with the `jobs` table for the running count per market.
 * `settings_address` / `project_access_key` mirror the market's settings
 * account, fetched whenever the market account is flagged restricted: such a
 * market only lets holders of the `project_access_key` NFT collection post
 * jobs. Both are null for a market open to all projects. The restricted flag
 * itself is masked out of `job_type`.
 */
export const markets = pgTable("markets", {
  address: varchar("address", { length: MAX_PUBKEY_LENGTH }).primaryKey(),
  authority: varchar("authority", { length: MAX_PUBKEY_LENGTH }),
  // 0 = JOB_QUEUE (jobs waiting), 1 = NODE_QUEUE (nodes waiting).
  queueType: integer("queue_type").notNull(),
  queue: jsonb("queue").$type<string[]>().notNull(),
  queueLength: integer("queue_length").notNull(),
  jobPrice: bigint("job_price", { mode: "number" }),
  jobTimeout: integer("job_timeout"),
  jobExpiration: integer("job_expiration"),
  jobType: integer("job_type"),
  settingsAddress: varchar("settings_address", { length: MAX_PUBKEY_LENGTH }),
  projectAccessKey: varchar("project_access_key", { length: MAX_PUBKEY_LENGTH }),
  updatedAt: integer("updated_at").notNull(),
});

export type InsertMarket = typeof markets.$inferInsert;
export type SelectMarket = typeof markets.$inferSelect;
