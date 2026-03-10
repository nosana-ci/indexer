import { integer, pgTable, serial, varchar, jsonb, real, index } from "drizzle-orm/pg-core";
import { desc } from "drizzle-orm";
import { MAX_PUBKEY_LENGTH } from "../constants";

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    address: varchar("address", { length: MAX_PUBKEY_LENGTH }).notNull().unique(),
    ipfsJob: varchar("ipfs_job", { length: 256 }),
    ipfsResult: varchar("ipfs_result", { length: 256 }),
    market: varchar("market", { length: MAX_PUBKEY_LENGTH }).notNull(),
    node: varchar("node", { length: MAX_PUBKEY_LENGTH }).notNull(),
    payer: varchar("payer", { length: MAX_PUBKEY_LENGTH }).notNull(),
    price: integer("price").notNull(),
    project: varchar("project", { length: MAX_PUBKEY_LENGTH }).notNull(),
    state: integer("state").notNull(),
    type: varchar("type", { length: 256 }),
    jobDefinition: jsonb("job_definition"),
    jobResult: jsonb("job_result"),
    jobStatus: varchar("job_status", { length: 256 }),
    timeEnd: integer("time_end").notNull(),
    timeStart: integer("time_start").notNull(),
    timeout: integer("timeout").notNull().default(7200),
    usdRewardPerHour: real("usd_reward_per_hour"),
    listedAt: integer("listed_at"),
  },
  (table) => ({
    stateTimeStartIdx: index("idx_jobs_state_timestart").on(table.state, desc(table.timeStart)),
  }),
);

export type InsertJob = typeof jobs.$inferInsert;
export type SelectJob = typeof jobs.$inferSelect;
