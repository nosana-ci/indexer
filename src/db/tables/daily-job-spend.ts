import { pgTable, serial, date, varchar, numeric, unique } from "drizzle-orm/pg-core";
import { MAX_PUBKEY_LENGTH } from "../constants";

export const dailyJobSpend = pgTable(
  "daily_job_spend",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    project: varchar("project", { length: MAX_PUBKEY_LENGTH }).notNull(),
    market: varchar("market", { length: MAX_PUBKEY_LENGTH }).notNull(),
    totalSpent: numeric("total_spent").notNull().default("0"),
  },
  (table) => ({
    dailyJobSpendUnique: unique("daily_job_spend_unique").on(
      table.date,
      table.project,
      table.market,
    ),
  }),
);

export type InsertDailyJobSpend = typeof dailyJobSpend.$inferInsert;
export type SelectDailyJobSpend = typeof dailyJobSpend.$inferSelect;
