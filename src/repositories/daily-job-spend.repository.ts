import { getDb } from "../db/client";
import { sql } from "drizzle-orm";

export default class DailyJobSpendRepository {
  private get db() {
    return getDb();
  }

  async upsertWithRecalculation(params: {
    date: string;
    project: string;
    market: string;
    totalSpent: number;
  }): Promise<void> {
    const { date, project, market, totalSpent } = params;

    await this.db.execute(sql`
      INSERT INTO daily_job_spend (date, project, market, total_spent)
      VALUES (${date}, ${project}, ${market}, ${totalSpent})
      ON CONFLICT (date, project, market) DO UPDATE
      SET total_spent = (
          SELECT COALESCE(SUM(
              (LEAST(sub.time_end - sub.time_start, sub.timeout) / 3600.0) *
              sub.usd_reward_per_hour
          ), 0)
          FROM jobs AS sub
          WHERE sub.project = ${project}
            AND sub.market = ${market}
            AND date(to_timestamp(sub.time_end) at time zone 'UTC') = ${date}
            AND sub.state = 2
            AND sub.usd_reward_per_hour IS NOT NULL
      )
    `);
  }
}
