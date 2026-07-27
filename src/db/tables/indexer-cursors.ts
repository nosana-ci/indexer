import { pgTable, serial, varchar, integer } from "drizzle-orm/pg-core";

const MAX_CURSOR_VALUE_LENGTH = 128;

/**
 * Mutable position markers for the resumable ingestion tasks — distinct from
 * `app_tasks_history`, which only records that a one-time task finished.
 *
 * The signature poller keeps its own watermark here rather than reading the
 * newest row of `program_transactions`: that table is also written by the logs
 * subscription, so a subscription-inserted signature would make the poll think
 * it had already caught up and silently skip everything below it.
 */
export const indexerCursors = pgTable("indexer_cursors", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: varchar("value", { length: MAX_CURSOR_VALUE_LENGTH }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type InsertIndexerCursor = typeof indexerCursors.$inferInsert;
export type SelectIndexerCursor = typeof indexerCursors.$inferSelect;
