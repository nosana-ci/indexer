import { Elysia, t } from "elysia";
import {
  getByAddressParams,
  jobResponse,
  jobBatchItemResponse,
  GetJobsQuery,
  GetJobsCountQuery,
  GetLongRunningJobsQuery,
  JobsCountResponse,
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
              "List jobs with optional filtering by state, market, node, poster, and payer",
            tags: ["Jobs"],
          },
        },
      ),
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
    },
  )
  .get(
    "/running-nodes",
    async ({ query, jobsService }) => {
      return await jobsService.getRunningNodesForMarket(query.market);
    },
    {
      query: t.Object({
        market: t.String({ error: "Please provide 'market' in query params" }),
      }),
      detail: {
        summary: "Get running nodes for a market",
        tags: ["Jobs"],
      },
    },
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
    },
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
          "Get aggregated job statistics with optional grouping and time series (filter by market, node, poster, payer)",
        tags: ["Jobs"],
      },
    },
  )
  .get(
    "/stats/timestamps",
    async ({ query, jobsService }) => {
      return await jobsService.getTimestamps(
        query.period ? parseInt(query.period) : (365 / 12) * 24 * 3600,
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
    },
  )
  .get(
    "/stats/timestamps-hours",
    async ({ query, jobsService }) => {
      return await jobsService.getDurationTimestamps(
        query.period ? parseInt(query.period) : (365 / 12) * 24 * 3600,
      );
    },
    {
      query: t.Object({
        period: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get GPU compute hours over time",
        description:
          "Time series of GPU compute hours (sum of effective completed-job runtime) bucketed by period, mirroring /stats/timestamps but with hours instead of job counts.",
        tags: ["Jobs"],
      },
    },
  )
  .get(
    "/count",
    async ({ query, jobsService }) => {
      return await jobsService.getJobsCount(query);
    },
    {
      query: GetJobsCountQuery,
      response: { 200: JobsCountResponse },
      detail: {
        summary: "Count jobs",
        description:
          "Get total job count and counts per state (QUEUED, RUNNING, COMPLETED, STOPPED), with optional filtering by market, node, project, and payer",
        tags: ["Jobs"],
      },
    },
  )
  .post(
    "/batch",
    async ({ body, jobsService }) => {
      return await jobsService.getJobsByAddresses(body.addresses, body.limit ?? 100);
    },
    {
      body: t.Object({
        addresses: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }),
      response: { 200: t.Array(jobBatchItemResponse) },
      detail: {
        summary: "Get jobs by addresses",
        description:
          "Retrieve multiple jobs by a list of addresses (full job fields except jobDefinition and jobResult). Maximum of 100 addresses per request.",
        tags: ["Jobs"],
      },
    },
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
    },
  );

export default jobsRouter;
