import { initEnv } from "../src/plugins/env";
import { buildDatabaseUrlFromParts } from "../src/db/connection-string";
import { defineConfig } from "drizzle-kit";

initEnv();

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
