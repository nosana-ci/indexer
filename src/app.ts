import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { jobsRouter } from "./modules/jobs/index.js";
import { statsRouter, type StatsService } from "./modules/stats/index.js";
import logger from "./logger.js";
import { AppError } from "./errors.js";

export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
} as const;

export const createApp = (options?: { statsService?: StatsService }) => {
  const app = new Elysia()
    .use(cors({ origin: process.env.CORS_ORIGIN ?? true }))
    .use(
      swagger({
        path: "/swagger",
        provider: "scalar",
        autoDarkMode: true,
        documentation: {
          info: {
            title: "Blockchain Indexer API",
            version: "1.0.0",
          },
          tags: [
            { name: "Jobs", description: "Job account and listing endpoints" },
            { name: "Stats", description: "Aggregated statistics endpoints" },
          ],
        },
      }),
    )
    .onAfterHandle(({ set }) => {
      Object.assign(set.headers, securityHeaders);
    })
    .onError(({ error, status, request }) => {
      if (error instanceof AppError) {
        logger.warn({ status: error.status, code: error.code, path: request.url }, error.message);
        return status(error.status, { message: error.message, code: error.code });
      }
      if (typeof error === "object" && error !== null && "status" in error && "message" in error) {
        const { status: errStatus, message } = error as {
          status: number;
          message: string;
        };
        return status(errStatus, { message });
      }
      logger.error({ err: error, method: request.method, path: request.url }, "Unhandled error");
      return status(500, { message: "Internal server error" });
    })
    .use(jobsRouter);

  if (options?.statsService) {
    app.use(statsRouter(options.statsService));
  }
  return app;
};
