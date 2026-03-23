import { getDb } from "../db/client";
import { sql } from "drizzle-orm";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "populate-earnings-spending" });

/**
 * One-time task to populate daily_earnings and daily_job_spend aggregation
 * tables from historical job data. This backfills all completed jobs that
 * existed before the indexer started tracking these rollups incrementally.
 */
export async function populateEarningAndSpendingDB() {
  const db = getDb();
  logger.info("Starting daily earnings and job spend population task");

  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE daily_job_spend, daily_earnings`);

    await tx.execute(sql`
      INSERT INTO daily_job_spend (date, project, market, total_spent)
      SELECT
        date(to_timestamp(jobs.time_end) at time zone 'UTC') AS day,
        jobs.project,
        jobs.market,
        SUM(
          (LEAST(jobs.time_end - jobs.time_start, jobs.timeout) / 3600.0)
          * jobs.usd_reward_per_hour
        ) AS total_spent
      FROM jobs
      WHERE jobs.state = 2
        AND jobs.time_end > 0
        AND jobs.usd_reward_per_hour IS NOT NULL
        AND jobs.usd_reward_per_hour > 0
      GROUP BY day, jobs.project, jobs.market
      ON CONFLICT (date, project, market) DO UPDATE
      SET total_spent = excluded.total_spent
    `);

    await tx.execute(sql`
      INSERT INTO daily_earnings (date, node, market, total_earned_usd)
      SELECT
        date(to_timestamp(jobs.time_end) at time zone 'UTC') AS day,
        jobs.node,
        jobs.market,
        SUM(
          (LEAST(jobs.time_end - jobs.time_start, jobs.timeout) / 3600.0)
          * jobs.usd_reward_per_hour
        ) AS total_earned_usd
      FROM jobs
      WHERE jobs.state = 2
        AND jobs.time_end > 0
        AND jobs.node IS NOT NULL
        AND jobs.usd_reward_per_hour IS NOT NULL
        AND jobs.usd_reward_per_hour > 0
      GROUP BY day, jobs.node, jobs.market
      ON CONFLICT (date, node, market) DO UPDATE
      SET total_earned_usd = excluded.total_earned_usd
    `);
  });

  logger.info("Daily earnings and job spend population task completed successfully");
}
