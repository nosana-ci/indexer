import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { jobsRouter } from "./modules/jobs";
import { statsRouter, type StatsService } from "./modules/stats";
import logger from "./logger";

export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
} as const;

export const createApp = (options?: { statsService?: StatsService }) => {
  const app = new Elysia()
    .use(cors({ origin: true }))
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
    .onError(({ error, status }) => {
      if (typeof error === "object" && error !== null && "status" in error && "message" in error) {
        const { status: errStatus, message } = error as {
          status: number;
          message: string;
        };
        return status(errStatus, { message });
      }
      logger.error({ err: error }, "Unhandled error");
      return status(500, { message: "Internal server error" });
    })
    .use(jobsRouter);

  if (options?.statsService) {
    app.use(statsRouter(options.statsService));
  }
  return app;
};
