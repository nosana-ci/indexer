import { getDb } from "../db/client";
import { stats, type InsertStats } from "../db/tables/stats";
import { desc } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

export default class StatsRepository {
  private get db() {
    return getDb();
  }

  async getLatestStats() {
    return this.db.select().from(stats).orderBy(desc(stats.date)).limit(1).execute();
  }

  async insertStats(data: InsertStats): Promise<void> {
    await this.db.insert(stats).values(data).execute();
  }

  async execute(query: SQL): Promise<Record<string, unknown>[]> {
    const result = await this.db.execute(query);
    const qr = result as { rows?: Record<string, unknown>[] };
    return qr.rows ?? [];
  }
}
