import { integer, pgTable, serial, varchar, jsonb, real, index } from "drizzle-orm/pg-core";
import { desc, sql } from "drizzle-orm";
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
    // GET /jobs lists newest first, unfiltered or by node/market. Without these
    // a deep page sorts the whole table on disk and holds a connection for an hour.
    timeStartIdx: index("idx_jobs_timestart").on(desc(table.timeStart)),
    nodeTimeStartIdx: index("idx_jobs_node_timestart").on(table.node, desc(table.timeStart)),
    marketTimeStartIdx: index("idx_jobs_market_timestart").on(table.market, desc(table.timeStart)),
    // Partial covering index for the compute-hours/duration aggregation
    // (GET /jobs/stats/timestamps-hours). Covers completed jobs with a real end
    // time as well as running jobs (which have time_end = 0 and are bounded by
    // now()/timeout at query time). Keeping time_end/timeout in the index lets
    // Postgres satisfy the source scan with an index-only scan, which keeps the
    // query fast even across millions of jobs.
    durationCoverIdx: index("idx_jobs_duration_cover")
      .on(table.state, table.timeStart, table.timeEnd, table.timeout)
      .where(sql`${table.state} = 1 OR (${table.state} = 2 AND ${table.timeEnd} > 0)`),
    // Completed jobs by end time: the job_stats_hourly refresh finds the jobs
    // that ended inside its window without scanning every completed job.
    completedTimeEndIdx: index("idx_jobs_completed_timeend")
      .on(table.timeEnd)
      .where(sql`${table.state} = 2`),
  }),
);

export type InsertJob = typeof jobs.$inferInsert;
export type SelectJob = typeof jobs.$inferSelect;
