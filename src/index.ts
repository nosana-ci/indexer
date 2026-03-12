import { initEnv } from "./plugins/env";
import { createApp } from "./app";
import { runMigrations } from "./db/migrate";
import { closePool } from "./db/client";
import { runStartupTasks } from "./tasks";
import { Indexer } from "./indexer/indexer";
import { createNosanaClient, type NosanaNetwork, type PartialClientConfig } from "@nosana/kit";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { cron } from "@elysiajs/cron";
import { StatsService } from "./modules/stats";
import JobCleanerService from "./services/job-cleaner.service";
import logger from "./logger";

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
    logger.debug({ adminAddress: adminSigner.address }, "Job cleaner enabled");
  } catch (error) {
    logger.error({ err: error }, "Failed to initialize job cleaner");
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
        logger.info("Running Jobs GPA and Markets GPA");
        try {
          await indexer.jobsGPA();
          logger.info("Jobs GPA completed successfully");
          await indexer.marketsGPA();
          logger.info("Markets GPA completed successfully");
        } catch (error) {
          logger.error({ err: error }, "Jobs GPA or Markets GPA failed");
        }
      },
    }),
  )
  .use(
    cron({
      name: "job-processing",
      pattern: "*/2 * * * *",
      async run() {
        logger.info("Running Job Processing");
        try {
          await indexer.processJobs();
          logger.info("Job Processing completed successfully");
        } catch (error) {
          logger.error({ err: error }, "Job Processing failed");
        }
      },
    }),
  )
  .use(
    cron({
      name: "refresh-stats",
      pattern: "*/5 * * * *",
      async run() {
        logger.info("Refreshing stats");
        try {
          await statsService.refreshStats();
          logger.info("Refresh stats completed successfully");
        } catch (error) {
          logger.error({ err: error }, "Refresh stats failed");
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
        logger.info("Running Job Cleaner");
        try {
          await cleaner.cleanJobs();
          logger.info("Job Cleaner completed successfully");
        } catch (error) {
          logger.error({ err: error }, "Job Cleaner failed");
        }
      },
    }),
  );
}

app.listen(Number(process.env.PORT) || 3000);

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  "Blockchain Indexer is running",
);

try {
  logger.info("Starting indexer WebSocket monitoring");
  await indexer.start();
  logger.info("Indexer WebSocket monitoring started");
} catch (error) {
  logger.error({ err: error }, "Failed to start indexer WebSocket monitoring");
  logger.info("API server will continue running");
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdown = async () => {
  logger.info("Shutting down gracefully");

  const forceExit = setTimeout(() => {
    logger.warn("Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    indexer.stop();
    app.server?.stop(true);
    await closePool();
    logger.info("Shutdown complete");
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
