import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db } from "../plugins/db";
import logger from "../logger";

export async function runMigrations(retries = 5, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await migrate(db, {
        migrationsFolder: "./drizzle",
      });
      return;
    } catch (error: unknown) {
      // Concurrent CREATE SCHEMA IF NOT EXISTS can race across containers
      const isDuplicate =
        error instanceof Error && "code" in error && (error as { code: string }).code === "23505";

      if (isDuplicate && attempt < retries) {
        logger.warn({ attempt, retries }, "Migration hit duplicate key race condition, retrying");
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw error;
    }
  }
}
