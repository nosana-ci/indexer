import { NotFoundError } from 'elysia';
import {
  lt,
  and,
  eq,
  gt,
  desc,
  count,
  asc,
  ne,
  gte,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { jobs, type SelectJob } from '../../db/tables/jobs';
import {
  GroupBy,
  type GetJobsQuery,
  type StatsType,
  type StatsTotals,
  type StatsByProject,
  type StatsByMarket,
  type StatsTimeSeries,
  jobStateMappingReverse,
} from './model';
import type { JobResponse } from './model';

export class JobsService {
  private statsCache?: StatsType;
  private db: NodePgDatabase<typeof schema>;

  constructor(db: NodePgDatabase<typeof schema>) {
    this.db = db;
  }

  async getByAddress(address: string): Promise<JobResponse> {
    const job = await this.db.query.jobs.findFirst({
      where: eq(jobs.address, address),
    });

    if (!job) {
      throw new NotFoundError('Job not found');
    }

    return this.mapToResponse(job);
  }

  async getJobs(query: typeof GetJobsQuery.static) {
    const maxLimit = 50;
    const effectiveLimit = Math.min(query.limit ?? 10, maxLimit);

    const result = await this.db
      .select()
      .from(jobs)
      .orderBy(desc(jobs.timeStart))
      .where(() => {
        const conditions = [];

        if (query.state) {
          conditions.push(
            eq(jobs.state, jobStateMappingReverse[query.state])
          );
        }
        if (query.market) {
          conditions.push(eq(jobs.market, query.market));
        }
        if (query.node) {
          conditions.push(eq(jobs.node, query.node));
        }
        if (query.poster) {
          conditions.push(eq(jobs.project, query.poster));
        }
        return conditions.length ? and(...conditions) : undefined;
      })
      .limit(effectiveLimit)
      .offset(query.offset ?? 0)
      .execute();

    const totalJobsQuery = this.db
      .select({ count: count() })
      .from(jobs)
      .where(() => {
        const conditions = [];

        if (query.state) {
          conditions.push(
            eq(jobs.state, jobStateMappingReverse[query.state])
          );
        }
        if (query.market) {
          conditions.push(eq(jobs.market, query.market));
        }
        if (query.node) {
          conditions.push(eq(jobs.node, query.node));
        }
        if (query.poster) {
          conditions.push(eq(jobs.project, query.poster));
        }
        return conditions.length ? and(...conditions) : undefined;
      });

    const totalJobs = await totalJobsQuery.execute();

    return {
      jobs: result,
      totalJobs: totalJobs[0].count,
    };
  }

  async getRunningJobs() {
    const runningJobsQuery = this.db
      .select({ running: count(), market: jobs.market })
      .from(jobs)
      .where(eq(jobs.state, jobStateMappingReverse['RUNNING']))
      .groupBy(jobs.market);

    const runningJobs = await runningJobsQuery.execute();

    return Object.fromEntries(
      runningJobs.map((k) => [k.market, { running: k.running }])
    );
  }

  async getRunningNodesForMarket(market: string): Promise<string[]> {
    const runningState = jobStateMappingReverse['RUNNING'];

    const rows = await this.db
      .selectDistinct({ node: jobs.node })
      .from(jobs)
      .where(
        and(eq(jobs.market, market), eq(jobs.state, runningState))
      )
      .execute();

    return rows.map((row) => row.node);
  }

  async getLongRunningJobs(market?: string, payer?: string) {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const conditions = [
      eq(jobs.timeEnd, 0),
      ne(jobs.timeStart, 0),
      lt(
        sql`COALESCE(${jobs.timeStart}, 0) + COALESCE(${jobs.timeout}, 0)`,
        currentTimestamp
      ),
    ];

    if (market) {
      conditions.push(eq(jobs.market, market));
    }

    if (payer) {
      conditions.push(eq(jobs.payer, payer));
    }

    const result = await this.db
      .select({
        address: jobs.address,
        timeStart: jobs.timeStart,
        timeout: jobs.timeout,
        market: jobs.market,
      })
      .from(jobs)
      .where(and(...conditions))
      .orderBy(asc(jobs.timeStart))
      .execute();

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
      {} as Record<
        string,
        Array<{ address: string; timeStart: number; timeout: number }>
      >
    );
  }

  async getStats(query: typeof GetJobsQuery.static): Promise<StatsType> {
    const noFiltersOrGrouping =
      !query.market &&
      !query.node &&
      !query.poster &&
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

      conditions.push(eq(jobs.state, jobStateMappingReverse['COMPLETED']));
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
      if (query.timeStart) {
        conditions.push(gte(jobs.timeStart, query.timeStart));
      }
      if (query.timeEnd) {
        conditions.push(lte(jobs.timeEnd, query.timeEnd));
      }

      const multiplier = query.useMultiplier ? 1.1 : 1.0;

      const baseCTE = this.db.$with('jobs_base').as(
        this.db
          .select({
            project: jobs.project,
            market: jobs.market,
            timeStart: jobs.timeStart,
            timeEnd: jobs.timeEnd,
            timeout: jobs.timeout,
            price: jobs.price,
            usdRewardPerHour: jobs.usdRewardPerHour,
            effectiveRuntimeSeconds:
              sql<number>`LEAST((${jobs.timeEnd} - ${jobs.timeStart}), ${jobs.timeout})`.as(
                'effectiveRuntimeSeconds'
              ),
          })
          .from(jobs)
          .where(and(...conditions))
      );

      const effectivePrice = (table: any) =>
        sql<number>`sum((${table.effectiveRuntimeSeconds}) * (${table.price}/1e6) * ${multiplier})::numeric(15, 6)`;
      const effectiveUsdReward = (table: any) =>
        sql<number>`sum((${table.effectiveRuntimeSeconds}) * (${table.usdRewardPerHour}) / 3600.0)::numeric(15, 6)`;
      const sumDuration = (table: any) =>
        sql<number>`sum(${table.effectiveRuntimeSeconds})`;

      const groupByProject = query.groupBy === GroupBy.Project;
      const groupByMarket = query.groupBy === GroupBy.Market;

      if (query.timeSeriesInterval) {
        const bucketedCTE = this.db.$with('jobs_bucketed').as(
          this.db
            .with(baseCTE)
            .select({
              bucket:
                sql<string>`date_trunc(${query.timeSeriesInterval}, to_timestamp(${baseCTE.timeStart}))`.as(
                  'bucket'
                ),
              project: baseCTE.project,
              market: baseCTE.market,
              effectiveRuntimeSeconds: baseCTE.effectiveRuntimeSeconds,
              price: baseCTE.price,
              usdRewardPerHour: baseCTE.usdRewardPerHour,
            })
            .from(baseCTE)
        );

        const select: Record<string, any> = {
          time: bucketedCTE.bucket,
          completed: count(),
          duration: sumDuration(bucketedCTE),
          price: effectivePrice(bucketedCTE),
          usdReward: effectiveUsdReward(bucketedCTE),
        };
        const groupByFields: any[] = [bucketedCTE.bucket];

        if (groupByMarket) {
          select.market = bucketedCTE.market;
          groupByFields.push(bucketedCTE.market);
        }

        if (groupByProject) {
          select.project = bucketedCTE.project;
          groupByFields.push(bucketedCTE.project);
        }

        const timeSeriesRows = await this.db
          .with(baseCTE, bucketedCTE)
          .select(select)
          .from(bucketedCTE)
          .groupBy(...groupByFields)
          .orderBy(bucketedCTE.bucket);

        const nestedData = this.nestTimeSeriesData(
          timeSeriesRows,
          groupByProject,
          groupByMarket
        );

        stats = { retrieved: now, series: nestedData } as StatsTimeSeries;
      } else if (groupByMarket) {
        const rows = await this.db
          .with(baseCTE)
          .select({
            market: baseCTE.market,
            completed: count(),
            duration: sumDuration(baseCTE),
            price: effectivePrice(baseCTE),
            usdReward: effectiveUsdReward(baseCTE),
          })
          .from(baseCTE)
          .groupBy(baseCTE.market)
          .execute();

        const totals = rows.reduce(
          (acc, r) => {
            acc.completed += Number(r.completed || 0);
            acc.duration += Number(r.duration || 0);
            acc.price += Number(r.price || 0);
            acc.usdReward += Number(r.usdReward || 0);
            return acc;
          },
          { completed: 0, duration: 0, price: 0, usdReward: 0 }
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
        const rows = await this.db
          .with(baseCTE)
          .select({
            project: baseCTE.project,
            completed: count(),
            duration: sumDuration(baseCTE),
            price: effectivePrice(baseCTE),
            usdReward: effectiveUsdReward(baseCTE),
          })
          .from(baseCTE)
          .groupBy(baseCTE.project)
          .execute();

        const totals = rows.reduce(
          (acc, r) => {
            acc.completed += Number(r.completed || 0);
            acc.duration += Number(r.duration || 0);
            acc.price += Number(r.price || 0);
            acc.usdReward += Number(r.usdReward || 0);
            return acc;
          },
          { completed: 0, duration: 0, price: 0, usdReward: 0 }
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
        const rows = await this.db
          .with(baseCTE)
          .select({
            completed: count(),
            duration: sumDuration(baseCTE),
            price: effectivePrice(baseCTE),
            usdReward: effectiveUsdReward(baseCTE),
          })
          .from(baseCTE)
          .execute();

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
      throw new Error('Failed to compute stats');
    }
    return stats;
  }

  private nestTimeSeriesData(
    data: any[],
    groupByProject?: boolean,
    groupByMarket?: boolean
  ) {
    const nested: Record<string, any> = {};

    for (const row of data) {
      const {
        time,
        project,
        market,
        completed,
        duration,
        price,
        usdReward,
      } = row;
      if (!nested[time]) {
        nested[time] = {
          time,
          completed: 0,
          duration: 0,
          price: 0,
          usdReward: 0,
          ...(groupByProject ? { projects: [] as any[] } : {}),
          ...(groupByMarket && !groupByProject ? { markets: [] as any[] } : {}),
        };
      }

      nested[time].completed += Number(completed || 0);
      nested[time].duration += Number(duration || 0);
      nested[time].price += Number(price || 0);
      nested[time].usdReward += Number(usdReward || 0);

      if (groupByProject && project) {
        let projectGroup = nested[time].projects.find(
          (p: any) => p.project === project
        );
        if (!projectGroup) {
          projectGroup = {
            project,
            completed: 0,
            duration: 0,
            price: 0,
            usdReward: 0,
          };
          nested[time].projects.push(projectGroup);
        }
        projectGroup.completed += Number(completed || 0);
        projectGroup.duration += Number(duration || 0);
        projectGroup.price += Number(price || 0);
        projectGroup.usdReward += Number(usdReward || 0);
      } else if (groupByMarket && market) {
        nested[time].markets.push({
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
    const jobRows = await this.db.query.jobs.findMany({
      where: and(
        gt(jobs.timeStart, 0),
        gt(
          jobs.timeStart,
          period ? Math.floor(Date.now() / 1000) - period : 0
        )
      ),
      columns: {
        timeStart: true,
      },
    });
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
          (currentDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)
        );

        const weekNumber = Math.ceil(days / 7);
        let granularity: string | null;
        if (period > (365 / 3) * 24 * 3600) {
          granularity =
            weekNumber +
            currentDate.getFullYear().toString();
        } else if (period > 5 * 24 * 3600) {
          granularity = currentDate.toISOString().split('T')[0];
        } else if (period > 12 * 3600) {
          granularity = `${currentDate.getHours()} ${currentDate.toISOString().split('T')[0]}`;
        } else if (period > 0) {
          granularity = `${currentDate.getHours()}:${currentDate.getMinutes()} ${currentDate.toISOString().split('T')[0]}`;
        } else {
          granularity = `${currentDate.getMonth() + 1}/${currentDate.getFullYear()}`;
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
