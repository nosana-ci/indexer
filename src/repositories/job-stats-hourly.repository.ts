import { count, eq, gt, gte, min, sql, sum } from "drizzle-orm";
import { getDb } from "../db/client";
import { jobs } from "../db/tables/jobs";
import { jobStatsHourly } from "../db/tables/job-stats-hourly";
import { computeSecondsByBucket, epochMs } from "./jobs.repository";

export type JobStatsBucketUnit = "hour" | "day" | "week" | "month";

const HOUR = 3600;

// Pure: the start of the UTC hour containing `unixSeconds`.
function startOfHour(unixSeconds: number): number {
  return Math.floor(unixSeconds / HOUR) * HOUR;
}

export default class JobStatsHourlyRepository {
  private get db() {
    return getDb();
  }

  /**
   * Recomputes the rollup for every hour from `windowHours` ago to now, or for
   * every hour since the first job when `windowHours` is null or the table is
   * empty. Recent hours are the ones running, finishing and late-indexed jobs
   * change; a full rebuild corrects anything older. The write is one statement,
   * so a rebuild is all or nothing. Returns how many hours were written.
   */
  async refresh(windowHours: number | null): Promise<number> {
    const since = await this.findRefreshStart(windowHours);
    if (since === null) return 0;

    const started = this.db.$with("started").as(
      this.db
        .select({
          hour: sql<Date>`date_trunc('hour', to_timestamp(${jobs.timeStart}))`.as("hour"),
          n: count().as("n"),
        })
        .from(jobs)
        .where(gte(jobs.timeStart, since))
        .groupBy(sql`1`),
    );
    const compute = this.db.$with("compute").as(computeSecondsByBucket(since, "hour"));
    // Every hour of the window, so an hour that dropped to zero is rewritten too.
    // Named `slot`: drizzle leaves CTE columns unqualified, so `hour` would clash
    // with `started.hour`.
    const hour = sql<Date>`series.slot`;

    const rows = this.db
      .with(started, compute)
      .select({
        hour: hour.as("hour"),
        jobsStarted: sql<number>`COALESCE(${started.n}, 0)`.as("jobs_started"),
        computeSeconds: sql<number>`COALESCE(${compute.seconds}, 0)`.as("compute_seconds"),
        updatedAt: sql<Date>`now()`.as("updated_at"),
      })
      .from(
        sql`generate_series(to_timestamp(${since}), date_trunc('hour', now()), interval '1 hour') AS series(slot)`,
      )
      .leftJoin(started, eq(started.hour, hour))
      .leftJoin(compute, eq(compute.bucketStart, hour));

    const result = await this.db
      .insert(jobStatsHourly)
      .select(rows)
      .onConflictDoUpdate({
        target: jobStatsHourly.hour,
        set: {
          jobsStarted: sql`excluded.jobs_started`,
          computeSeconds: sql`excluded.compute_seconds`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    return result.rowCount ?? 0;
  }

  // Epoch seconds of the first hour to recompute: `windowHours` ago once the
  // table is built, else the first job's hour; null when there are no jobs.
  private async findRefreshStart(windowHours: number | null): Promise<number | null> {
    if (windowHours !== null) {
      const built = await this.db
        .select({ hour: jobStatsHourly.hour })
        .from(jobStatsHourly)
        .limit(1);
      if (built.length > 0) return startOfHour(Date.now() / 1000 - windowHours * HOUR);
    }
    const [first] = await this.db
      .select({ timeStart: min(jobs.timeStart) })
      .from(jobs)
      .where(gt(jobs.timeStart, 0));
    return first?.timeStart ? startOfHour(first.timeStart) : null;
  }

  /**
   * Jobs started and compute seconds per `unit` bucket (UTC), newest first,
   * for the hours from the one containing `sinceUnix` onward. `bucket` is the
   * bucket start in epoch milliseconds.
   */
  async findBucketsSince(sinceUnix: number, unit: JobStatsBucketUnit) {
    // Grouped by position: the unit is a parameter, so a repeated expression
    // would not match the selected one.
    return this.db
      .select({
        bucket: epochMs(sql`date_trunc(${unit}, ${jobStatsHourly.hour})`),
        jobs: sum(jobStatsHourly.jobsStarted).mapWith(Number),
        seconds: sum(jobStatsHourly.computeSeconds).mapWith(Number),
      })
      .from(jobStatsHourly)
      .where(gte(jobStatsHourly.hour, new Date(startOfHour(sinceUnix) * 1000)))
      .groupBy(sql`1`)
      .orderBy(sql`1 DESC`);
  }
}
