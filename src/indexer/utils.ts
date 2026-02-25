import type { Job, NosanaClient } from '@nosana/kit';
import { address } from '@nosana/kit';
import type { InsertJob, SelectJob } from '../db/tables/jobs';

export function jobsAreEqual(dbJob: SelectJob, nosanaJob: Job): boolean {
  return (
    dbJob.state === nosanaJob.state &&
    dbJob.timeStart === nosanaJob.timeStart &&
    dbJob.timeEnd === nosanaJob.timeEnd &&
    dbJob.timeout === nosanaJob.timeout &&
    dbJob.price === nosanaJob.price &&
    dbJob.node === nosanaJob.node &&
    dbJob.market === nosanaJob.market.toString() &&
    dbJob.payer === nosanaJob.payer.toString() &&
    dbJob.project === nosanaJob.project.toString() &&
    dbJob.ipfsJob === nosanaJob.ipfsJob &&
    dbJob.ipfsResult === nosanaJob.ipfsResult
  );
}

export function convertJobToInsertJob(
  job: Job | (Partial<Job> & { address: Job['address'] })
): InsertJob | (Partial<InsertJob> & { address: InsertJob['address'] }) {
  const result: Partial<InsertJob> & { address: InsertJob['address'] } = {
    address: job.address.toString(),
  };

  if ('ipfsJob' in job && job.ipfsJob !== undefined) {
    result.ipfsJob = job.ipfsJob;
  }
  if ('ipfsResult' in job && job.ipfsResult !== undefined) {
    result.ipfsResult = job.ipfsResult;
  }
  if ('market' in job && job.market !== undefined) {
    result.market = job.market.toString();
  }
  if ('node' in job && job.node !== undefined) {
    result.node = job.node.toString();
  }
  if ('payer' in job && job.payer !== undefined) {
    result.payer = job.payer.toString();
  }
  if ('price' in job && job.price !== undefined) {
    result.price = Number(job.price);
  }
  if ('project' in job && job.project !== undefined) {
    result.project = job.project.toString();
  }
  if ('state' in job && job.state !== undefined) {
    result.state = job.state;
  }
  if ('timeEnd' in job && job.timeEnd !== undefined) {
    result.timeEnd = Number(job.timeEnd);
  }
  if ('timeStart' in job && job.timeStart !== undefined) {
    result.timeStart = Number(job.timeStart);
  }
  if ('timeout' in job && job.timeout !== undefined) {
    result.timeout = Number(job.timeout);
  }

  return result;
}

export async function checkJobExists(
  nosanaClient: NosanaClient,
  jobAddress: string
): Promise<boolean> {
  try {
    await nosanaClient.jobs.get(address(jobAddress));
    return true;
  } catch (e: unknown) {
    if (
      e &&
      typeof e === 'object' &&
      'message' in e &&
      typeof e.message === 'string' &&
      (e.message.includes('Account does not exist or has no data') ||
        e.message.includes('Account not found at address'))
    ) {
      return false;
    }
    throw e;
  }
}

export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
