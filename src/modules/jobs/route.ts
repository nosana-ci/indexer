import { Elysia, t } from "elysia";
import {
  getByAddressParams,
  jobResponse,
  GetJobsQuery,
  GetLongRunningJobsQuery,
} from "./model";
import { JobsService } from "./service";
import {
  jobsRateLimit,
  jobsHourlyRateLimit,
  jobsDailyRateLimit,
} from "../../middleware/rate-limit";

const jobsService = new JobsService();

const jobsRouter = new Elysia({ prefix: "/jobs" })
  .decorate("jobsService", jobsService)
  .group("", (app) =>
    app
      .use(jobsRateLimit())
      .use(jobsHourlyRateLimit())
      .use(jobsDailyRateLimit())
      .get(
        "/",
        async ({ jobsService, query }) => {
          return await jobsService.getJobs(query);
        },
        {
          query: GetJobsQuery,
          detail: {
            summary: "List jobs",
            description:
              "List jobs with optional filtering by state, market, node, and poster",
            tags: ["Jobs"],
          },
        }
      )
  )
  .get(
    "/running",
    async ({ jobsService }) => {
      return await jobsService.getRunningJobs();
    },
    {
      detail: {
        summary: "Get running jobs count per market",
        tags: ["Jobs"],
      },
    }
  )
  .get(
    "/running-nodes",
    async ({ query, jobsService }) => {
      if (!query.market) {
        throw new Error("Please provide 'market' in query params");
      }
      return await jobsService.getRunningNodesForMarket(query.market);
    },
    {
      query: t.Object({
        market: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get running nodes for a market",
        tags: ["Jobs"],
      },
    }
  )
  .get(
    "/long-running",
    async ({ query, jobsService }) => {
      return await jobsService.getLongRunningJobs(query.market, query.payer);
    },
    {
      query: GetLongRunningJobsQuery,
      detail: {
        summary: "Get long-running jobs",
        description:
          "Returns jobs running longer than their timeout, optionally filtered by market or payer",
        tags: ["Jobs"],
      },
    }
  )
  .get(
    "/stats",
    async ({ query, jobsService }) => {
      return await jobsService.getStats(query);
    },
    {
      query: GetJobsQuery,
      detail: {
        summary: "Get job statistics",
        description:
          "Get aggregated job statistics with optional grouping and time series",
        tags: ["Jobs"],
      },
    }
  )
  .get(
    "/stats/timestamps",
    async ({ query, jobsService }) => {
      return await jobsService.getTimestamps(
        query.period ? parseInt(query.period) : (365 / 12) * 24 * 3600
      );
    },
    {
      query: t.Object({
        period: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get job timestamps",
        tags: ["Jobs"],
      },
    }
  )
  .get(
    "/:address",
    async ({ params: { address }, jobsService }) => {
      return await jobsService.getByAddress(address);
    },
    {
      params: getByAddressParams,
      response: {
        200: jobResponse,
        404: t.Object({
          message: t.String(),
        }),
      },
      detail: {
        summary: "Get job by address",
        description: "Retrieve a job account by its address",
        tags: ["Jobs"],
      },
    }
  );

export default jobsRouter;
