import { getDb } from '../db/client';
import { jobs, type InsertJob, type SelectJob } from '../db/tables/jobs';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

export default class JobsRepository {
  private get db() {
    return getDb();
  }

  private withAlias(name: string) {
    return this.db.$with(name);
  }

  // ── CRUD (used by the indexer) ──────────────────────────────────────

  async findByAddress(address: string): Promise<SelectJob | undefined> {
    return this.db.query.jobs.findFirst({
      where: eq(jobs.address, address),
    });
  }

  async findQueuedByMarket(marketAddress: string): Promise<SelectJob[]> {
    return this.db
      .select()
      .from(jobs)
      .where(
        and(eq(jobs.state, 0), eq(jobs.market, marketAddress))
      )
      .execute();
  }

  async findJobsToProcess(params: {
    limit?: number;
    minTimeEnd?: number;
  }): Promise<SelectJob[]> {
    const { limit = 500, minTimeEnd = 1727690400 } = params;

    return this.db
      .select()
      .from(jobs)
      .where(
        and(
          or(
            isNull(jobs.listedAt),
            isNull(jobs.jobDefinition),
            isNull(jobs.usdRewardPerHour),
            and(
              eq(jobs.state, 2),
              isNull(jobs.jobResult),
              isNotNull(jobs.ipfsResult)
            )
          ),
          gt(jobs.timeEnd, minTimeEnd)
        )
      )
      .limit(limit)
      .orderBy(asc(jobs.jobDefinition), asc(jobs.timeEnd))
      .execute();
  }

  async upsert(jobData: InsertJob): Promise<SelectJob> {
    const result = await this.db
      .insert(jobs)
      .values(jobData)
      .onConflictDoUpdate({
        target: jobs.address,
        set: jobData,
        where: and(
          lte(jobs.state, jobData.state),
          or(
            lt(jobs.state, jobData.state),
            lt(jobs.timeout, jobData.timeout!),
            and(eq(jobs.state, 2), isNull(jobs.ipfsResult))
          )
        ),
      })
      .returning()
      .execute();

    return result[0] as SelectJob;
  }

  async update(
    address: string,
    updates: Partial<InsertJob>
  ): Promise<SelectJob | null> {
    const orConditions = [];
    const whereConditions = [eq(jobs.address, address)];

    if (updates.state !== undefined) {
      orConditions.push(lt(jobs.state, updates.state));
      whereConditions.push(lte(jobs.state, updates.state));
    }

    if (updates.timeout !== undefined) {
      orConditions.push(lt(jobs.timeout, updates.timeout));
    }

    orConditions.push(
      and(eq(jobs.state, 2), isNull(jobs.ipfsResult))
    );

    if (orConditions.length > 0) {
      const orCondition = or(...orConditions);
      if (orCondition) {
        whereConditions.push(orCondition);
      }
    }

    const result = await this.db
      .update(jobs)
      .set(updates)
      .where(and(...whereConditions))
      .returning()
      .execute();

    return result.length > 0 ? result[0] : null;
  }

  async simpleUpdate(
    address: string,
    updates: Partial<InsertJob>
  ): Promise<void> {
    await this.db
      .update(jobs)
      .set(updates)
      .where(eq(jobs.address, address))
      .execute();
  }

  async delete(address: string): Promise<void> {
    await this.db
      .delete(jobs)
      .where(eq(jobs.address, address))
      .execute();
  }

  // ── Query methods (used by the API service) ─────────────────────────

  async findMany(params: {
    limit: number;
    offset: number;
    state?: number;
    market?: string;
    node?: string;
    poster?: string;
    payer?: string;
  }) {
    const { limit, offset, state, market, node, poster, payer } = params;
    const conditions = [];
    if (state !== undefined) conditions.push(eq(jobs.state, state));
    if (market) conditions.push(eq(jobs.market, market));
    if (node) conditions.push(eq(jobs.node, node));
    if (poster) conditions.push(eq(jobs.project, poster));
    if (payer) conditions.push(eq(jobs.payer, payer));

    return this.db
      .select()
      .from(jobs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(jobs.timeStart))
      .limit(limit)
      .offset(offset)
      .execute();
  }

  async countMany(params: {
    state?: number;
    market?: string;
    node?: string;
    poster?: string;
    payer?: string;
  }) {
    const { state, market, node, poster, payer } = params;
    const conditions = [];
    if (state !== undefined) conditions.push(eq(jobs.state, state));
    if (market) conditions.push(eq(jobs.market, market));
    if (node) conditions.push(eq(jobs.node, node));
    if (poster) conditions.push(eq(jobs.project, poster));
    if (payer) conditions.push(eq(jobs.payer, payer));

    const rows = await this.db
      .select({ count: count() })
      .from(jobs)
      .where(conditions.length ? and(...conditions) : undefined)
      .execute();
    return rows[0]?.count ?? 0;
  }

  async findByAddresses(addresses: string[], limit: number) {
    if (addresses.length === 0) return [];

    return this.db
      .select({
        id: jobs.id,
        address: jobs.address,
        ipfsJob: jobs.ipfsJob,
        ipfsResult: jobs.ipfsResult,
        market: jobs.market,
        node: jobs.node,
        payer: jobs.payer,
        price: jobs.price,
        project: jobs.project,
        state: jobs.state,
        type: jobs.type,
        jobStatus: jobs.jobStatus,
        timeEnd: jobs.timeEnd,
        timeStart: jobs.timeStart,
        timeout: jobs.timeout,
        usdRewardPerHour: jobs.usdRewardPerHour,
        listedAt: jobs.listedAt,
      })
      .from(jobs)
      .where(inArray(jobs.address, addresses))
      .limit(limit)
      .execute();
  }

  /**
   * Returns job counts grouped by state, with optional filters (market, node, project, payer).
   */
  async countByState(params: {
    market?: string;
    node?: string;
    project?: string;
    payer?: string;
  }): Promise<{ state: number; count: number }[]> {
    const { market, node, project, payer } = params;
    const conditions = [];
    if (market) conditions.push(eq(jobs.market, market));
    if (node) conditions.push(eq(jobs.node, node));
    if (project) conditions.push(eq(jobs.project, project));
    if (payer) conditions.push(eq(jobs.payer, payer));

    return this.db
      .select({ state: jobs.state, count: count() })
      .from(jobs)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(jobs.state)
      .execute();
  }

  async countRunningByMarket() {
    return this.db
      .select({ running: count(), market: jobs.market })
      .from(jobs)
      .where(eq(jobs.state, 1))
      .groupBy(jobs.market)
      .execute();
  }

  async getRunningNodesForMarket(market: string, runningState: number) {
    return this.db
      .selectDistinct({ node: jobs.node })
      .from(jobs)
      .where(and(eq(jobs.market, market), eq(jobs.state, runningState)))
      .execute();
  }

  async findLongRunningJobs(
    currentTimestamp: number,
    market?: string,
    payer?: string
  ) {
    const conditions = [
      eq(jobs.timeEnd, 0),
      ne(jobs.timeStart, 0),
      lt(
        sql`COALESCE(${jobs.timeStart}, 0) + COALESCE(${jobs.timeout}, 0)`,
        currentTimestamp
      ),
    ];

    if (market) conditions.push(eq(jobs.market, market));
    if (payer) conditions.push(eq(jobs.payer, payer));

    return this.db
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
  }

  async findCompletedForCleaning(
    blockchainAddresses: string[],
    completedWithResultOlderThan: number,
    completedOlderThan: number,
    limit = 150
  ): Promise<SelectJob[]> {
    return this.db.query.jobs.findMany({
      where: and(
        or(
          and(
            lt(jobs.timeEnd, completedWithResultOlderThan),
            isNotNull(jobs.ipfsResult)
          ),
          lt(jobs.timeEnd, completedOlderThan)
        ),
        eq(jobs.state, 2),
        inArray(jobs.address, blockchainAddresses)
      ),
      limit,
    });
  }

  async findTimeStartsSince(sinceUnix: number) {
    return this.db.query.jobs.findMany({
      where: and(
        gt(jobs.timeStart, 0),
        gt(jobs.timeStart, sinceUnix)
      ),
      columns: {
        timeStart: true,
      },
    });
  }

  // ── Stats aggregation queries ───────────────────────────────────────

  createStatsBaseCte(conditions: SQL[]) {
    return this.withAlias('jobs_base').as(
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
  }

  createStatsBucketedCte(
    baseCte: any,
    timeSeriesInterval: string,
    groupByMarket: boolean
  ) {
    return this.withAlias('jobs_bucketed').as(
      this.db
        .with(baseCte)
        .select({
          bucket:
            sql<string>`date_trunc(${timeSeriesInterval}, to_timestamp(${baseCte.timeStart}))`.as(
              'bucket'
            ),
          project: baseCte.project,
          market: baseCte.market,
          effectiveRuntimeSeconds: baseCte.effectiveRuntimeSeconds,
          price: baseCte.price,
          usdRewardPerHour: baseCte.usdRewardPerHour,
        })
        .from(baseCte)
    );
  }

  async getStatsTimeSeriesRows(
    baseCte: any,
    bucketedCte: any,
    select: Record<string, any>,
    groupBy: any[]
  ) {
    return this.db
      .with(baseCte, bucketedCte)
      .select(select)
      .from(bucketedCte)
      .groupBy(...groupBy)
      .orderBy(bucketedCte.bucket);
  }

  async getStatsByMarketRows(baseCte: any, multiplier: number) {
    const effectivePrice = sql<number>`sum((${baseCte.effectiveRuntimeSeconds}) * (${baseCte.price}/1e6) * ${multiplier})::numeric(15, 6)`;
    const effectiveUsdReward = sql<number>`sum((${baseCte.effectiveRuntimeSeconds}) * (${baseCte.usdRewardPerHour}) / 3600.0)::numeric(15, 6)`;
    const sumDuration = sql<number>`sum(${baseCte.effectiveRuntimeSeconds})`;

    return this.db
      .with(baseCte)
      .select({
        market: baseCte.market,
        completed: count(),
        duration: sumDuration,
        price: effectivePrice,
        usdReward: effectiveUsdReward,
      })
      .from(baseCte)
      .groupBy(baseCte.market)
      .execute();
  }

  async getStatsByProjectRows(baseCte: any, multiplier: number) {
    const effectivePrice = sql<number>`sum((${baseCte.effectiveRuntimeSeconds}) * (${baseCte.price}/1e6) * ${multiplier})::numeric(15, 6)`;
    const effectiveUsdReward = sql<number>`sum((${baseCte.effectiveRuntimeSeconds}) * (${baseCte.usdRewardPerHour}) / 3600.0)::numeric(15, 6)`;
    const sumDuration = sql<number>`sum(${baseCte.effectiveRuntimeSeconds})`;

    return this.db
      .with(baseCte)
      .select({
        project: baseCte.project,
        completed: count(),
        duration: sumDuration,
        price: effectivePrice,
        usdReward: effectiveUsdReward,
      })
      .from(baseCte)
      .groupBy(baseCte.project)
      .execute();
  }

  async getStatsTotals(baseCte: any, multiplier: number) {
    const effectivePrice = sql<number>`sum((${baseCte.effectiveRuntimeSeconds}) * (${baseCte.price}/1e6) * ${multiplier})::numeric(15, 6)`;
    const effectiveUsdReward = sql<number>`sum((${baseCte.effectiveRuntimeSeconds}) * (${baseCte.usdRewardPerHour}) / 3600.0)::numeric(15, 6)`;
    const sumDuration = sql<number>`sum(${baseCte.effectiveRuntimeSeconds})`;

    return this.db
      .with(baseCte)
      .select({
        completed: count(),
        duration: sumDuration,
        price: effectivePrice,
        usdReward: effectiveUsdReward,
      })
      .from(baseCte)
      .execute();
  }
}
