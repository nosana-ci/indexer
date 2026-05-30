import dayjs from "dayjs";
import { NotFoundError } from "elysia";
import { eq, gt, gte, lt, lte, count, sql } from "drizzle-orm";
import { jobs, type SelectJob } from "../../db/tables/jobs";
import JobsRepository from "../../repositories/jobs.repository";
import { AppError } from "../../errors";
import {
  GroupBy,
  JobState,
  type GetJobsQuery,
  type StatsType,
  type StatsTotals,
  type StatsByProject,
  type StatsByMarket,
  type StatsTimeSeries,
  jobStateMappingReverse,
} from "./model";
import type { JobResponse, JobBatchItemResponse } from "./model";

export class JobsService {
  private statsCache?: StatsType;
  private readonly timestampsCache = new Map<
    string,
    {
      expiresAt: number;
      value: { total: number; data: Array<{ x: number; y: number }> };
    }
  >();
  private readonly jobsRepo: JobsRepository;

  constructor() {
    this.jobsRepo = new JobsRepository();
  }

  async getByAddress(address: string): Promise<JobResponse> {
    const job = await this.jobsRepo.findByAddress(address);

    if (!job) {
      throw new NotFoundError("Job not found");
    }

    return this.mapToResponse(job);
  }

  async getJobs(query: typeof GetJobsQuery.static) {
    const maxLimit = 50;
    const effectiveLimit = Math.min(query.limit ?? 10, maxLimit);
    const state = query.state ? jobStateMappingReverse[query.state] : undefined;

    const [result, totalJobs] = await Promise.all([
      this.jobsRepo.findMany({
        limit: effectiveLimit,
        offset: query.offset ?? 0,
        state,
        market: query.market,
        node: query.node,
        poster: query.poster,
        payer: query.payer,
      }),
      this.jobsRepo.countMany({
        state,
        market: query.market,
        node: query.node,
        poster: query.poster,
        payer: query.payer,
      }),
    ]);

    return {
      jobs: result,
      totalJobs,
    };
  }

  async getJobsByAddresses(addresses: string[], limit: number): Promise<JobBatchItemResponse[]> {
    const maxLimit = 100;
    const effectiveLimit = Math.min(limit, maxLimit);
    return this.jobsRepo.findByAddresses(addresses, effectiveLimit);
  }

  async getRunningJobs() {
    const runningJobs = await this.jobsRepo.countRunningByMarket();

    return Object.fromEntries(runningJobs.map((k) => [k.market, { running: k.running }]));
  }

  /**
   * Returns total job count and counts per state, with optional filters (market, node, project, payer).
   */
  async getJobsCount(query: { market?: string; node?: string; poster?: string; payer?: string }) {
    const rows = await this.jobsRepo.countByState({
      market: query.market,
      node: query.node,
      poster: query.poster,
      payer: query.payer,
    });

    const stateNames: Record<number, keyof typeof JobState> = {
      0: "QUEUED",
      1: "RUNNING",
      2: "COMPLETED",
      3: "STOPPED",
    };

    const byState = {
      [JobState.QUEUED]: 0,
      [JobState.RUNNING]: 0,
      [JobState.COMPLETED]: 0,
      [JobState.STOPPED]: 0,
    };

    let total = 0;
    for (const { state, count } of rows) {
      const name = stateNames[state];
      if (name !== undefined) {
        byState[name] = Number(count);
        total += Number(count);
      }
    }

    return { total, byState };
  }

  /**
   * Returns the node addresses of jobs in a "RUNNING" state for a given market.
   */
  async getRunningNodesForMarket(market: string): Promise<string[]> {
    const runningState = jobStateMappingReverse["RUNNING"];
    const rows = await this.jobsRepo.getRunningNodesForMarket(market, runningState);
    return rows.map((row) => row.node);
  }

  /**
   * Returns jobs running longer than their timeout,
   * optionally filtered by market or payer.
   */
  async getLongRunningJobs(market?: string, payer?: string) {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const result = await this.jobsRepo.findLongRunningJobs(currentTimestamp, market, payer);

    if (market) {
      return {
        market,
        jobs: result.map(({ market: _, ...rest }) => rest),
      };
    }

    return result.reduce(
      (acc, job) => {
        if (!acc[job.market]) {
          acc[job.market] = [];
        }
        acc[job.market].push({
          address: job.address,
          timeStart: job.timeStart,
          timeout: job.timeout,
        });
        return acc;
      },
      {} as Record<string, Array<{ address: string; timeStart: number; timeout: number }>>,
    );
  }

  // TODO: use proper cache for stats
  async getStats(query: typeof GetJobsQuery.static): Promise<StatsType> {
    const noFiltersOrGrouping =
      !query.market &&
      !query.node &&
      !query.poster &&
      !query.payer &&
      !query.timeStart &&
      !query.timeEnd &&
      !query.groupBy &&
      !query.timeSeriesInterval &&
      !query.useMultiplier;

    let stats: StatsType | undefined =
      query.skipCache || !noFiltersOrGrouping ? undefined : this.statsCache;
    const now = Math.floor(Date.now() / 1e3);
    if (!stats || now > stats.retrieved + 60) {
      const conditions = [];

      conditions.push(eq(jobs.state, jobStateMappingReverse["COMPLETED"]));
      conditions.push(gt(jobs.timeStart, 0));
      conditions.push(gt(jobs.timeEnd, 0));
      conditions.push(lt(jobs.price, 10000000));

      if (query.market) {
        conditions.push(eq(jobs.market, query.market));
      }
      if (query.node) {
        conditions.push(eq(jobs.node, query.node));
      }
      if (query.poster) {
        conditions.push(eq(jobs.project, query.poster));
      }
      if (query.payer) {
        conditions.push(eq(jobs.payer, query.payer));
      }
      if (query.timeStart) {
        conditions.push(gte(jobs.timeStart, query.timeStart));
      }
      if (query.timeEnd) {
        conditions.push(lte(jobs.timeEnd, query.timeEnd));
      }

      const multiplier = query.useMultiplier ? 1.1 : 1.0;

      const baseCTE = this.jobsRepo.createStatsBaseCte(conditions);

      /* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle CTE column references */
      const effectivePrice = (table: any) =>
        sql<number>`sum((${table.effectiveRuntimeSeconds}) * (${table.price}/1e6) * ${multiplier})::numeric(15, 6)`;
      const effectiveUsdReward = (table: any) =>
        sql<number>`sum((${table.effectiveRuntimeSeconds}) * (${table.usdRewardPerHour}) / 3600.0)::numeric(15, 6)`;
      const sumDuration = (table: any) => sql<number>`sum(${table.effectiveRuntimeSeconds})`;
      /* eslint-enable @typescript-eslint/no-explicit-any */

      const groupByProject = query.groupBy === GroupBy.Project;
      const groupByMarket = query.groupBy === GroupBy.Market;

      if (query.timeSeriesInterval) {
        const bucketedCTE = this.jobsRepo.createStatsBucketedCte(
          baseCTE,
          query.timeSeriesInterval,
          groupByMarket,
        );

        /* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle CTE select/groupBy fields have complex inferred types */
        const select: Record<string, any> = {
          time: bucketedCTE.bucket,
          completed: count(),
          duration: sumDuration(bucketedCTE),
          price: effectivePrice(bucketedCTE),
          usdReward: effectiveUsdReward(bucketedCTE),
        };
        const groupByFields: any[] = [bucketedCTE.bucket];
        /* eslint-enable @typescript-eslint/no-explicit-any */

        if (groupByMarket) {
          select.market = bucketedCTE.market;
          groupByFields.push(bucketedCTE.market);
        }

        if (groupByProject) {
          select.project = bucketedCTE.project;
          groupByFields.push(bucketedCTE.project);
        }

        const timeSeriesRows = await this.jobsRepo.getStatsTimeSeriesRows(
          baseCTE,
          bucketedCTE,
          select,
          groupByFields,
        );

        const nestedData = this.nestTimeSeriesData(timeSeriesRows, groupByProject, groupByMarket);

        stats = { retrieved: now, series: nestedData } as StatsTimeSeries;
      } else if (groupByMarket) {
        const rows = await this.jobsRepo.getStatsByMarketRows(baseCTE, multiplier);

        const totals = rows.reduce(
          (acc, r) => {
            acc.completed += Number(r.completed || 0);
            acc.duration += Number(r.duration || 0);
            acc.price += Number(r.price || 0);
            acc.usdReward += Number(r.usdReward || 0);
            return acc;
          },
          { completed: 0, duration: 0, price: 0, usdReward: 0 },
        );

        stats = {
          retrieved: now,
          completed: totals.completed,
          duration: totals.duration,
          price: totals.price,
          usdReward: totals.usdReward,
          markets: rows.map((r) => ({
            market: r.market,
            name: null,
            completed: Number(r.completed || 0),
            duration: Number(r.duration || 0),
            price: Number(r.price || 0),
            usdReward: Number(r.usdReward || 0),
          })),
        } as StatsByMarket;
      } else if (groupByProject) {
        const rows = await this.jobsRepo.getStatsByProjectRows(baseCTE, multiplier);

        const totals = rows.reduce(
          (acc, r) => {
            acc.completed += Number(r.completed || 0);
            acc.duration += Number(r.duration || 0);
            acc.price += Number(r.price || 0);
            acc.usdReward += Number(r.usdReward || 0);
            return acc;
          },
          { completed: 0, duration: 0, price: 0, usdReward: 0 },
        );

        stats = {
          retrieved: now,
          completed: totals.completed,
          duration: totals.duration,
          price: totals.price,
          usdReward: totals.usdReward,
          projects: rows.map((r) => ({
            project: r.project,
            completed: Number(r.completed || 0),
            duration: Number(r.duration || 0),
            price: Number(r.price || 0),
            usdReward: Number(r.usdReward || 0),
          })),
        } as StatsByProject;
      } else {
        const rows = await this.jobsRepo.getStatsTotals(baseCTE, multiplier);

        const totals = rows[0];
        const completed = Number(totals?.completed || 0);
        const duration = String(Number(totals?.duration || 0));
        const price = Number(totals?.price || 0).toFixed(6);
        const usdReward = Number(totals?.usdReward || 0).toFixed(6);
        stats = {
          completed,
          duration,
          price,
          usdReward,
          retrieved: now,
        } as StatsTotals;
      }

      if (!query.skipCache && noFiltersOrGrouping) {
        this.statsCache = stats;
      }
    }
    if (!stats) {
      throw new AppError("Failed to compute stats", 500);
    }
    return stats;
  }

  private nestTimeSeriesData(
    data: Array<Record<string, unknown>>,
    groupByProject?: boolean,
    groupByMarket?: boolean,
  ) {
    interface StatsEntry {
      time: unknown;
      completed: number;
      duration: number;
      price: number;
      usdReward: number;
      projects?: Array<StatsGroupEntry>;
      markets?: Array<Record<string, unknown>>;
    }
    interface StatsGroupEntry {
      project: unknown;
      completed: number;
      duration: number;
      price: number;
      usdReward: number;
    }
    const nested: Record<string, StatsEntry> = {};

    for (const row of data) {
      const { time, project, market, completed, duration, price, usdReward } = row;
      const timeKey = String(time);
      if (!nested[timeKey]) {
        nested[timeKey] = {
          time,
          completed: 0,
          duration: 0,
          price: 0,
          usdReward: 0,
          ...(groupByProject ? { projects: [] as StatsGroupEntry[] } : {}),
          ...(groupByMarket && !groupByProject
            ? { markets: [] as Array<Record<string, unknown>> }
            : {}),
        };
      }

      nested[timeKey].completed += Number(completed || 0);
      nested[timeKey].duration += Number(duration || 0);
      nested[timeKey].price += Number(price || 0);
      nested[timeKey].usdReward += Number(usdReward || 0);

      if (groupByProject && project) {
        let projectGroup = nested[timeKey].projects?.find((p) => p.project === project);
        if (!projectGroup) {
          projectGroup = {
            project,
            completed: 0,
            duration: 0,
            price: 0,
            usdReward: 0,
          };
          nested[timeKey].projects?.push(projectGroup);
        }
        projectGroup.completed += Number(completed || 0);
        projectGroup.duration += Number(duration || 0);
        projectGroup.price += Number(price || 0);
        projectGroup.usdReward += Number(usdReward || 0);
      } else if (groupByMarket && market) {
        nested[timeKey].markets?.push({
          market,
          name: null,
          completed,
          duration,
          price,
          usdReward,
        });
      }
    }

    return Object.values(nested);
  }

  async getTimestamps(period: number) {
    return this.getCachedTimestampSeries("count", period, async () => {
      const jobRows = await this.jobsRepo.findTimeStartsSince(
        period ? Math.floor(Date.now() / 1000) - period : 0,
      );
      const timeStamps = jobRows.map((job: { timeStart: number }) => job.timeStart);
      const updatedData: Array<{ x: number; y: number }> = [];
      const tempDateCollection: Array<string | null> = [];
      timeStamps
        .sort((a: number, b: number) => b - a)
        .forEach((j: number) => {
          const timestamp = j * 1000;
          const currentDate = new Date(timestamp);
          const startDate = new Date(currentDate.getFullYear(), 0, 1);
          const days = Math.floor(
            (currentDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
          );

          const weekNumber = Math.ceil(days / 7);
          let granularity: string | null;
          if (period > (365 / 3) * 24 * 3600) {
            // Bigger than 4 months, group by week
            granularity = weekNumber + dayjs(timestamp).format("YYYY");
          } else if (period > 5 * 24 * 3600) {
            // Bigger than 5 days, group by day
            granularity = dayjs(timestamp).format("DD/MMM/YYYY");
          } else if (period > 12 * 3600) {
            // Bigger than 12 hours, group by hour
            granularity = dayjs(timestamp).format("HH DD/MMM/YYYY");
          } else if (period > 0) {
            // Under 12 hours
            granularity = dayjs(timestamp).format("HH:mm DD/MMM/YYYY");
          } else {
            // All: group by month
            granularity = dayjs(timestamp).format("MMM/YYYY");
          }
          if (granularity && tempDateCollection.includes(granularity)) {
            const index = tempDateCollection.indexOf(granularity);
            const element = updatedData[index];
            updatedData[index] = {
              x: updatedData[index].x,
              y: element.y + 1,
            };
          } else {
            tempDateCollection.push(granularity);
            updatedData.push({
              x: timestamp,
              y: 1,
            });
          }
        });

      return {
        total: jobRows.length,
        data: updatedData,
      };
    });
  }

  /**
   * Returns GPU compute hours (sum of effective job runtime) bucketed over
   * time, mirroring the shape of {@link getTimestamps} but with `y` being
   * hours instead of a job count. Aggregation happens in Postgres so only one
   * row per bucket is returned, which stays fast even with millions of jobs.
   */
  async getDurationTimestamps(period: number) {
    return this.getCachedTimestampSeries("duration", period, async () => {
      const since = period ? Math.floor(Date.now() / 1000) - period : 0;
      const interval = this.resolveBucketInterval(period);

      const rows = await this.jobsRepo.getDurationBucketsSince(since, interval);

      let total = 0;
      const data = rows.map((row) => {
        const hours = Number(row.seconds) / 3600;
        total += hours;
        return { x: Number(row.bucket), y: Math.round(hours * 100) / 100 };
      });

      return {
        total: Math.round(total * 100) / 100,
        data,
      };
    });
  }

  /**
   * Maps a lookback period (in seconds) to a Postgres `date_trunc` unit,
   * matching the bucket granularity used by {@link getTimestamps} and the
   * explorer chart.
   */
  private resolveBucketInterval(period: number): "week" | "day" | "hour" | "minute" | "month" {
    if (period > (365 / 3) * 24 * 3600) return "week";
    if (period > 5 * 24 * 3600) return "day";
    if (period > 12 * 3600) return "hour";
    if (period > 0) return "minute";
    return "month";
  }

  private async getCachedTimestampSeries(
    cacheName: "count" | "duration",
    period: number,
    load: () => Promise<{ total: number; data: Array<{ x: number; y: number }> }>,
  ) {
    const cacheKey = `${cacheName}:${period}`;
    const now = Math.floor(Date.now() / 1000);
    const cached = this.timestampsCache.get(cacheKey);

    if (cached && now < cached.expiresAt) {
      return cached.value;
    }

    const value = await load();
    this.timestampsCache.set(cacheKey, {
      expiresAt: now + this.getTimestampCacheTtl(period),
      value,
    });
    return value;
  }

  private getTimestampCacheTtl(period: number) {
    if (period === 0 || period >= 365 * 24 * 3600) {
      return 24 * 60 * 60;
    }
    if (period >= (365 / 4) * 24 * 3600) {
      return 12 * 60 * 60;
    }
    if (period >= (365 / 12) * 24 * 3600) {
      return 6 * 60 * 60;
    }
    if (period >= 7 * 24 * 3600) {
      return 3 * 60 * 60;
    }
    if (period >= 24 * 3600) {
      return 60 * 60;
    }
    return 3 * 60;
  }

  private mapToResponse(job: SelectJob): JobResponse {
    return {
      id: job.id,
      address: job.address,
      ipfsJob: job.ipfsJob,
      ipfsResult: job.ipfsResult,
      market: job.market,
      node: job.node,
      payer: job.payer,
      price: job.price,
      project: job.project,
      state: job.state,
      type: job.type,
      jobDefinition: job.jobDefinition,
      jobResult: job.jobResult,
      jobStatus: job.jobStatus,
      timeEnd: job.timeEnd,
      timeStart: job.timeStart,
      timeout: job.timeout,
      usdRewardPerHour: job.usdRewardPerHour,
      listedAt: job.listedAt,
    };
  }
}
