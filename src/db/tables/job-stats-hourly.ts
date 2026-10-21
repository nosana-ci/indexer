import { bigint, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/**
 * Hourly rollup behind the job time series (GET /jobs/stats/timestamps and
 * /jobs/stats/timestamps-hours): how many jobs started in each UTC hour, and
 * how many compute seconds (completed and running jobs, time-weighted across
 * the hours they span) fall inside it. Maintained by the cron so the endpoints
 * read a few thousand rows instead of scanning every job.
 */
export const jobStatsHourly = pgTable("job_stats_hourly", {
  hour: timestamp("hour", { withTimezone: true }).primaryKey(),
  jobsStarted: integer("jobs_started").notNull(),
  computeSeconds: bigint("compute_seconds", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
