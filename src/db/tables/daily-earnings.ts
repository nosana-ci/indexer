import {
  pgTable,
  varchar,
  numeric,
  serial,
  date,
  unique,
} from 'drizzle-orm/pg-core';
import { MAX_PUBKEY_LENGTH } from '../constants';

export const dailyEarnings = pgTable(
  'daily_earnings',
  {
    id: serial('id').primaryKey(),
    date: date('date').notNull(),
    node: varchar('node', { length: MAX_PUBKEY_LENGTH }).notNull(),
    market: varchar('market', { length: MAX_PUBKEY_LENGTH }).notNull(),
    totalEarnedUsd: numeric('total_earned_usd').notNull().default('0'),
  },
  (table) => ({
    dailyEarningsUnique: unique('daily_earnings_unique').on(
      table.date,
      table.node,
      table.market
    ),
  })
);

export type InsertDailyEarning = typeof dailyEarnings.$inferInsert;
export type SelectDailyEarning = typeof dailyEarnings.$inferSelect;
