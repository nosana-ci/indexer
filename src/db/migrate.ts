import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";

import { getPool } from "../db/client";
import logger from "../logger";

const LOCK_KEY_1 = 123456789;
const LOCK_KEY_2 = 987654321;
const LOCK_TIMEOUT_MS = 60_000;

export async function withAdvisoryLock(
  pool: Pool,
  callback: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();

  try {
    logger.info("Acquiring migration advisory lock");
    await client.query(`SET statement_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_KEY_1, LOCK_KEY_2]);
    await client.query("SET statement_timeout = '0'");
    logger.info("Migration advisory lock acquired");

    await callback(client);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_KEY_1, LOCK_KEY_2]);
      logger.debug("Migration advisory lock released");
      // Back to the pool's statement_timeout before the connection is reused.
      await client.query("RESET statement_timeout");
    } catch (unlockError) {
      logger.warn({ err: unlockError }, "Failed to release migration advisory lock");
    }
    client.release();
  }
}

export async function runMigrations() {
  // On the lock's own connection (statement_timeout 0): an index build on a
  // large table must not hit the API pool's statement_timeout.
  await withAdvisoryLock(getPool(), async (client) => {
    await migrate(drizzle({ client }), { migrationsFolder: "./drizzle" });
    logger.info("Migrations completed successfully");
  });
}
