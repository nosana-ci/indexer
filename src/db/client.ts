import { initEnv } from "../plugins/env";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

initEnv();

function buildDatabaseUrlFromParts() {
  const host = process.env.POSTGRES_HOST;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB;
  const port = process.env.POSTGRES_PORT ?? "5432";

  if (!host || !user || !password || !database) return undefined;

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@${host}:${port}/${database}`;
}

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
  pool ??= new Pool({ connectionString: getConnectionString() });
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
