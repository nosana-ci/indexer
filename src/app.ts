import { Elysia } from "elysia";
import { jobs } from "./modules/jobs";
import { stats } from "./modules/stats";
import type StatsService from "./modules/stats/service";

export const createApp = (options?: { statsService?: StatsService }) => {
  const app = new Elysia()
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
    .use(jobs);

  if (options?.statsService) {
    app.use(stats(options.statsService));
  }
  return app;
};
