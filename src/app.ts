import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { jobsRouter } from "./modules/jobs";
import { statsRouter, type StatsService } from "./modules/stats";

export const createApp = (options?: { statsService?: StatsService }) => {
  const app = new Elysia()
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
      })
    )
    .onError(({ error, status }) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        "message" in error
      ) {
        const { status: errStatus, message } = error as {
          status: number;
          message: string;
        };
        return status(errStatus, { message });
      }
      console.error("Unhandled error:", error);
      return status(500, { message: "Internal server error" });
    })
    .get("/", () => "Hi")
    .use(jobsRouter);

  if (options?.statsService) {
    app.use(statsRouter(options.statsService));
  }
  return app;
};
