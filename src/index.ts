import { initEnv } from "./plugins/env";
import { createApp } from "./app";
import { runMigrations } from "./db/migrate";
import { Indexer } from "./indexer/indexer";
import {
  createNosanaClient,
  type NosanaNetwork,
  type PartialClientConfig,
} from "@nosana/kit";
import { cron } from "@elysiajs/cron";

initEnv();

await runMigrations();

const config: PartialClientConfig = {
  solana: {},
};

if (process.env.SOLANA_RPC) {
  config.solana!.rpcEndpoint = process.env.SOLANA_RPC;
}

const nosanaClient = createNosanaClient(
  (process.env.SOLANA_NETWORK || "mainnet") as NosanaNetwork,
  config
);

const indexer = new Indexer(nosanaClient);

const app = createApp()
  .get("/health", () => {
    const health = indexer.healthStatus;
    const timeSinceLastActivity = Date.now() - health.lastActivity.getTime();

    return {
      status: health.isRunning ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      indexer: {
        isRunning: health.isRunning,
        lastActivity: health.lastActivity.toISOString(),
        startTime: health.startTime?.toISOString() || null,
        uptime: health.uptime / 1000,
        timeSinceLastActivity,
      },
    };
  })
  .use(
    cron({
      name: "jobs-gpa",
      pattern: "*/5 * * * *",
      async run() {
        console.log("🚀 Running Jobs GPA and Markets GPA...");
        try {
          await indexer.jobsGPA();
          console.log("✅ Jobs GPA completed successfully");
          await indexer.marketsGPA();
          console.log("✅ Markets GPA completed successfully");
        } catch (error) {
          console.error("❌ Jobs GPA or Markets GPA failed:", error);
        }
      },
    })
  )
  .use(
    cron({
      name: "job-processing",
      pattern: "*/2 * * * *",
      async run() {
        console.log("🚀 Running Job Processing...");
        try {
          await indexer.processJobs();
          console.log("✅ Job Processing completed successfully");
        } catch (error) {
          console.error("❌ Job Processing failed:", error);
        }
      },
    })
  )
  .listen(Number(process.env.PORT) || 3000);

console.log(
  `⛓️ Blockchain Indexer is running at ${app.server?.hostname}:${app.server?.port}`
);

try {
  console.log("🚀 Starting indexer WebSocket monitoring...");
  await indexer.start();
  console.log("✅ Indexer WebSocket monitoring started");
} catch (error) {
  console.error("❌ Failed to start indexer WebSocket monitoring:", error);
  console.log("🚀 API server will continue running...");
}

const shutdown = () => {
  console.log("🛑 Shutting down gracefully...");
  indexer.stop();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
