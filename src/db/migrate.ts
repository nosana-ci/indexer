import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db } from "../plugins/db";

export async function runMigrations() {
  await migrate(db, {
    migrationsFolder: "./drizzle",
  });
}
