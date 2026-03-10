import { getDb } from "../db/client";
import { sql } from "drizzle-orm";

export default class DailyEarningsRepository {
  private get db() {
    return getDb();
  }

  async upsertWithRecalculation(params: {
    date: string;
    node: string;
    market: string;
    totalEarnedUsd: number;
  }): Promise<void> {
    const { date, node, market, totalEarnedUsd } = params;

    await this.db.execute(sql`
      INSERT INTO daily_earnings (date, node, market, total_earned_usd)
      VALUES (${date}, ${node}, ${market}, ${totalEarnedUsd})
      ON CONFLICT (date, node, market) DO UPDATE
      SET total_earned_usd = (
          SELECT COALESCE(SUM((LEAST(sub.time_end - sub.time_start, sub.timeout) / 3600.0) * sub.usd_reward_per_hour), 0)
          FROM jobs AS sub
          WHERE sub.node = ${node}
            AND sub.market = ${market}
            AND date(to_timestamp(sub.time_end) at time zone 'UTC') = ${date}
            AND sub.state = 2
            AND sub.usd_reward_per_hour IS NOT NULL
      )
    `);
  }
}
