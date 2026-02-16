import { initEnv } from "../src/plugins/env";
import { defineConfig } from "drizzle-kit";

initEnv();

function buildDatabaseUrlFromParts() {
  const host = process.env.POSTGRES_HOST;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB;
  const port = process.env.POSTGRES_PORT ?? "5432";

  if (!host || !user || !password || !database) return undefined;

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password
  )}@${host}:${port}/${database}`;
}

// `drizzle-kit generate` doesn't require a live DB connection, but the config
// still expects a URL string. We provide a sensible default to keep generation
// working even before you have DB credentials.
const databaseUrl =
  process.env.DATABASE_URL ??
  buildDatabaseUrlFromParts() ??
  "postgresql://postgres:postgres@localhost:5432/postgres";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
