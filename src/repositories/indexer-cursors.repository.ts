import { getDb } from "../db/client";
import { indexerCursors } from "../db/tables/indexer-cursors";
import { eq, sql } from "drizzle-orm";

/** Reads and writes the resumable ingestion position markers. */
export default class IndexerCursorsRepository {
  private get db() {
    return getDb();
  }

  async get(key: string): Promise<string | undefined> {
    const rows = await this.db
      .select({ value: indexerCursors.value })
      .from(indexerCursors)
      .where(eq(indexerCursors.key, key))
      .limit(1)
      .execute();
    return rows[0]?.value;
  }

  async set(key: string, value: string): Promise<void> {
    const updatedAt = sql`extract(epoch from now())::int`;
    await this.db
      .insert(indexerCursors)
      .values({ key, value, updatedAt: updatedAt as unknown as number })
      .onConflictDoUpdate({ target: indexerCursors.key, set: { value, updatedAt } })
      .execute();
  }

  async clear(key: string): Promise<void> {
    await this.db.delete(indexerCursors).where(eq(indexerCursors.key, key)).execute();
  }
}
