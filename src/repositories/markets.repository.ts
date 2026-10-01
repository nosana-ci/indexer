import { getDb } from "../db/client";
import { markets, type InsertMarket, type SelectMarket } from "../db/tables/markets";
import { eq, sql } from "drizzle-orm";
import { MarketQueueType } from "@nosana/kit";

export type QueuedNodeRow = { marketAddress: string; nodeAddress: string; position: number };

export default class MarketsRepository {
  private get db() {
    return getDb();
  }

  /** Upserts a market's current state (keyed by address). */
  async upsert(market: InsertMarket): Promise<void> {
    await this.db
      .insert(markets)
      .values(market)
      .onConflictDoUpdate({ target: markets.address, set: market })
      .execute();
  }

  async findAll(): Promise<SelectMarket[]> {
    return this.db.select().from(markets).orderBy(markets.address).execute();
  }

  async findByAddress(address: string): Promise<SelectMarket | undefined> {
    return this.db.query.markets.findFirst({ where: eq(markets.address, address) });
  }

  /**
   * Flattens every node-queue market's queue into one row per queued node,
   * with `position` as the node's 0-based index in that market's queue.
   * Job-queue markets are excluded; ordered by market, then position.
   */
  async findQueuedNodes(): Promise<QueuedNodeRow[]> {
    const result = await this.db.execute<QueuedNodeRow>(sql`
      SELECT
        m.address AS "marketAddress",
        q.node AS "nodeAddress",
        (q.ord - 1)::int AS "position"
      FROM markets m
      CROSS JOIN LATERAL jsonb_array_elements_text(m.queue) WITH ORDINALITY AS q(node, ord)
      WHERE m.queue_type = ${MarketQueueType.NODE_QUEUE}
      ORDER BY m.address, q.ord
    `);
    return result.rows;
  }
}
