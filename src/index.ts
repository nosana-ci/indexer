import { initEnv } from "./plugins/env";
import { createApp } from "./app";
import { runMigrations } from "./db/migrate";

initEnv();

// Run drizzle migrations
await runMigrations();

const app = createApp().listen(Number(process.env.PORT) || 3000);

console.log(
  `⛓️ Blockchain Indexer is running at ${app.server?.hostname}:${app.server?.port}`
);
