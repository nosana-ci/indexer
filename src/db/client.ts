import { initEnv } from "../plugins/env";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildDatabaseUrlFromParts } from "./connection-string";
import * as schema from "./schema";

initEnv();

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL ?? buildDatabaseUrlFromParts();

  if (!connectionString) {
    throw new Error(
      "Missing database credentials. Set DATABASE_URL or POSTGRES_HOST/POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB (and optionally POSTGRES_PORT).",
    );
  }

  return connectionString;
}

let pool: Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

export function getPool() {
  pool ??= new Pool({
    connectionString: getConnectionString(),
    max: Number(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30_000,
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS) || 5_000,
  });
  return pool;
}

export function getDb() {
  db ??= drizzle({ client: getPool(), schema });
  return db;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
