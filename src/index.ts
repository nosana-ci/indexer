import { initEnv } from "./plugins/env";
import { createApp } from "./app";
import { runMigrations } from "./db/migrate";
import { runStartupTasks } from "./tasks";
import { Indexer } from "./indexer/indexer";
import { createNosanaClient, type NosanaNetwork, type PartialClientConfig } from "@nosana/kit";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { cron } from "@elysiajs/cron";
import { StatsService } from "./modules/stats";
import JobCleanerService from "./services/job-cleaner.service";

initEnv();

await runMigrations();
await runStartupTasks();

const config: PartialClientConfig = {
  solana: {
    priorityFees: { type: "fixed", microLamports: 50 },
  },
};

if (process.env.SOLANA_RPC) {
  config.solana!.rpcEndpoint = process.env.SOLANA_RPC;
}

const nosanaClient = createNosanaClient(
  (process.env.SOLANA_NETWORK || "mainnet") as NosanaNetwork,
  config,
);

const indexer = new Indexer(nosanaClient);
const statsService = new StatsService(nosanaClient);

let jobCleanerService: JobCleanerService | null = null;

if (process.env.CLEAN_ADMIN_PRIVATE_KEY) {
  try {
    const keyBytes = new Uint8Array(JSON.parse(process.env.CLEAN_ADMIN_PRIVATE_KEY));
    const adminSigner = await createKeyPairSignerFromBytes(keyBytes);
    jobCleanerService = new JobCleanerService(nosanaClient, adminSigner);
    console.log(`Job cleaner enabled with admin address: ${adminSigner.address}`);
  } catch (error) {
    console.error("Failed to initialize job cleaner:", error);
  }
}

const app = createApp({ statsService })
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
    }),
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
    }),
  )
  .use(
    cron({
      name: "refresh-stats",
      pattern: "*/5 * * * *",
      async run() {
        console.log("🚀 Refresh Stats");
        try {
          await statsService.refreshStats();
          console.log("✅ Refresh Stats completed successfully");
        } catch (error) {
          console.error("❌ Refresh Stats failed:", error);
        }
      },
    }),
  );

if (jobCleanerService) {
  const cleaner = jobCleanerService;
  app.use(
    cron({
      name: "job-cleaner",
      pattern: "0 */6 * * *",
      async run() {
        console.log("🧹 Running Job Cleaner...");
        try {
          await cleaner.cleanJobs();
          console.log("✅ Job Cleaner completed successfully");
        } catch (error) {
          console.error("❌ Job Cleaner failed:", error);
        }
      },
    }),
  );
}

app.listen(Number(process.env.PORT) || 3000);

console.log(`⛓️ Blockchain Indexer is running at ${app.server?.hostname}:${app.server?.port}`);

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
