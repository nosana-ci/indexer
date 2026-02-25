import { getDb } from '../db/client';
import { jobs, type InsertJob, type SelectJob } from '../db/tables/jobs';
import {
  and,
  asc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from 'drizzle-orm';

export default class JobAccountsRepository {
  private get db() {
    return getDb();
  }

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
}
