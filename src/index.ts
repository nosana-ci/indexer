import { initEnv } from "./plugins/env.js";
import { createApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { closePool } from "./db/client.js";
import { runStartupTasks } from "./tasks/index.js";
import { Indexer } from "./indexer/indexer.js";
import { JobProcessor } from "./indexer/job-processor.js";
import { createNosanaClient, type NosanaNetwork, type PartialClientConfig } from "@nosana/kit";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { cron } from "@elysiajs/cron";
import { StatsService } from "./modules/stats/index.js";
import JobCleanerService from "./services/job-cleaner.service.js";
import logger from "./logger.js";
import { getAppMode, shouldRunApi, shouldRunIndexer, shouldRunCron } from "./config/mode.js";

initEnv();

const mode = getAppMode();
logger.info({ mode }, "Starting in mode");

await runMigrations();
await runStartupTasks();

// Create NosanaClient when needed (all modes except api)
let nosanaClient: ReturnType<typeof createNosanaClient> | null = null;

if (shouldRunIndexer(mode) || shouldRunCron(mode)) {
  const config: PartialClientConfig = {
    solana: {
      priorityFees: { type: "fixed", microLamports: 50 },
    },
  };

  if (process.env.SOLANA_RPC) {
    config.solana!.rpcEndpoint = process.env.SOLANA_RPC;
  }

  nosanaClient = createNosanaClient(
    (process.env.SOLANA_NETWORK || "mainnet") as NosanaNetwork,
    config,
  );
}

// Indexer (WebSocket monitor) — only in all/indexer modes
let indexer: Indexer | null = null;
if (shouldRunIndexer(mode) && nosanaClient) {
  indexer = new Indexer(nosanaClient);
}

// JobProcessor — only in cron mode (indexer mode gets it via Indexer)
let jobProcessor: JobProcessor | null = null;
if (shouldRunCron(mode) && !shouldRunIndexer(mode) && nosanaClient) {
  jobProcessor = new JobProcessor(nosanaClient);
}

// Resolve the processor for cron jobs (either from Indexer or standalone)
const processor = indexer?.jobProcessor ?? jobProcessor;

// Create StatsService in all/api/cron modes
// API mode: pass null (only reads from DB)
// cron/all modes: pass the client for refreshStats
let statsService: StatsService | null = null;

if (shouldRunApi(mode) || shouldRunCron(mode)) {
  statsService = new StatsService(nosanaClient);
}

// Create JobCleanerService only in all/cron modes
let jobCleanerService: JobCleanerService | null = null;

if (shouldRunCron(mode) && process.env.CLEAN_ADMIN_PRIVATE_KEY && nosanaClient) {
  try {
    const keyBytes = new Uint8Array(JSON.parse(process.env.CLEAN_ADMIN_PRIVATE_KEY));
    const adminSigner = await createKeyPairSignerFromBytes(keyBytes);
    jobCleanerService = new JobCleanerService(nosanaClient, adminSigner);
    logger.debug({ adminAddress: adminSigner.address }, "Job cleaner enabled");
  } catch (error) {
    logger.error({ err: error }, "Failed to initialize job cleaner");
  }
}

// Create the app — full routes in api/all modes, bare app otherwise
const app = shouldRunApi(mode)
  ? createApp({ statsService: statsService ?? undefined })
  : createApp();

// Health endpoint is always present
app.get("/health", () => {
  if (indexer) {
    const health = indexer.healthStatus;
    const timeSinceLastActivity = Date.now() - health.lastActivity.getTime();

    return {
      status: health.isRunning ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      mode,
      indexer: {
        isRunning: health.isRunning,
        lastActivity: health.lastActivity.toISOString(),
        startTime: health.startTime?.toISOString() || null,
        uptime: health.uptime / 1000,
        timeSinceLastActivity,
      },
    };
  }

  // api and cron modes — no indexer, always healthy (liveness = process is up)
  return {
    status: "healthy",
    timestamp: new Date().toISOString(),
    mode,
  };
});

// All cron jobs: only in all/cron modes
if (shouldRunCron(mode) && processor) {
  const proc = processor;
  app
    .use(
      cron({
        name: "jobs-gpa",
        pattern: "*/5 * * * *",
        protect: true,
        async run() {
          logger.info("Running Jobs GPA and Markets GPA");
          try {
            await proc.jobsGPA();
            logger.info("Jobs GPA completed successfully");
            await proc.marketsGPA();
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
        protect: true,
        async run() {
          logger.info("Running Job Processing");
          try {
            await proc.processJobs();
            logger.info("Job Processing completed successfully");
          } catch (error) {
            logger.error({ err: error }, "Job Processing failed");
          }
        },
      }),
    );
}

if (shouldRunCron(mode) && statsService) {
  const svc = statsService;
  app.use(
    cron({
      name: "refresh-stats",
      pattern: "*/5 * * * *",
      protect: true,
      async run() {
        logger.info("Refreshing stats");
        try {
          await svc.refreshStats();
          logger.info("Refresh stats completed successfully");
        } catch (error) {
          logger.error({ err: error }, "Refresh stats failed");
        }
      },
    }),
  );
}

if (shouldRunCron(mode) && jobCleanerService) {
  const cleaner = jobCleanerService;
  app.use(
    cron({
      name: "job-cleaner",
      pattern: "0 */6 * * *",
      protect: true,
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

// WebSocket monitoring: only in all/indexer modes
if (indexer) {
  try {
    logger.info("Starting indexer WebSocket monitoring");
    await indexer.start();
    logger.info("Indexer WebSocket monitoring started");
  } catch (error) {
    logger.error({ err: error }, "Failed to start indexer WebSocket monitoring");
    logger.info("API server will continue running");
  }
}

const SHUTDOWN_TIMEOUT_MS = 30_000;
const CRON_POLL_INTERVAL_MS = 500;

const shutdown = async () => {
  logger.info("Shutting down gracefully");

  const forceExit = setTimeout(() => {
    logger.warn("Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // Stop indexer WebSocket monitoring
    if (indexer) {
      indexer.stop();
    }

    // Stop cron scheduling and wait for in-flight jobs to complete
    const crons = (app.store as Record<string, unknown>).cron as
      | Record<string, { stop: () => void; isBusy: () => boolean }>
      | undefined;

    if (crons) {
      for (const [name, job] of Object.entries(crons)) {
        job.stop();
        logger.info({ cron: name }, "Stopped cron scheduling");
      }

      const busyJobNames = () =>
        Object.entries(crons)
          .filter(([, job]) => job.isBusy())
          .map(([name]) => name);

      let busy = busyJobNames();
      while (busy.length > 0) {
        logger.info({ jobs: busy }, "Waiting for in-flight cron jobs to complete");
        await new Promise((resolve) => setTimeout(resolve, CRON_POLL_INTERVAL_MS));
        busy = busyJobNames();
      }
    }

    // Stop HTTP server and close DB pool
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
