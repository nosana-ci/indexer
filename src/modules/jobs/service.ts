import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { jobs, type SelectJob } from '../../db/tables/jobs';
import type { JobResponse } from './model';

export class JobsService {
  constructor(private db: NodePgDatabase<any>) {}

  async getByAddress(address: string): Promise<JobResponse> {
    const job = await this.db.query.jobs.findFirst({
      where: eq(jobs.address, address),
    });

    if (!job) {
      throw {
        status: 404,
        message: "Job not found",
      };
    }

    return this.mapToResponse(job);
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
      benchmarkProcessedAt: job.benchmarkProcessedAt?.toISOString() ?? null,
      timeout: job.timeout,
      usdRewardPerHour: job.usdRewardPerHour,
      listedAt: job.listedAt,
    };
  }

}
