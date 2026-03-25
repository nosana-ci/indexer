import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

import { getDb, getPool } from "../db/client";
import logger from "../logger";

const LOCK_KEY_1 = 123456789;
const LOCK_KEY_2 = 987654321;
const LOCK_TIMEOUT_MS = 60_000;

export async function withAdvisoryLock(
  pool: Pool,
  callback: () => Promise<void>,
): Promise<void> {
  const client = await pool.connect();

  try {
    logger.info("Acquiring migration advisory lock");
    await client.query(`SET statement_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      LOCK_KEY_1,
      LOCK_KEY_2,
    ]);
    await client.query("SET statement_timeout = '0'");
    logger.info("Migration advisory lock acquired");

    await callback();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        LOCK_KEY_1,
        LOCK_KEY_2,
      ]);
      logger.debug("Migration advisory lock released");
    } catch (unlockError) {
      logger.warn(
        { err: unlockError },
        "Failed to release migration advisory lock",
      );
    }
    client.release();
  }
}

export async function runMigrations() {
  await withAdvisoryLock(getPool(), async () => {
    const db = getDb();
    await migrate(db, { migrationsFolder: "./drizzle" });
    logger.info("Migrations completed successfully");
  });
}
