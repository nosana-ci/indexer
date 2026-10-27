import type { Job, Market, MarketSettings, NosanaClient } from "@nosana/kit";
import { address } from "@nosana/kit";
import type { InsertJob, SelectJob } from "../db/tables/jobs";
import type { InsertMarket } from "../db/tables/markets";

// Flag the program sets in a market's `jobType` while it has a settings account
// (`MarketAccount::RESTRICTED`); the low bits keep the job type.
export const MARKET_RESTRICTED_FLAG = 0x80;

/** Whether the market is restricted to projects holding its access key. */
export function isMarketRestricted(market: Market): boolean {
  return (Number(market.jobType) & MARKET_RESTRICTED_FLAG) !== 0;
}

// Maps a Market account from @nosana/kit to a row for the markets table.
// `settings` is the market's settings account (`null` for an open market). When
// it is `undefined` (the fetch failed) the settings columns are left out, so an
// upsert keeps whatever the row already holds.
export function convertMarketToInsertMarket(
  market: Market,
  now: number,
  settings?: MarketSettings | null,
): InsertMarket {
  const queue = market.queue.map((a) => a.toString());
  return {
    address: market.address.toString(),
    authority: market.authority?.toString() ?? null,
    queueType: Number(market.queueType),
    queue,
    queueLength: queue.length,
    jobPrice: market.jobPrice != null ? Number(market.jobPrice) : null,
    jobTimeout: market.jobTimeout != null ? Number(market.jobTimeout) : null,
    jobExpiration: market.jobExpiration != null ? Number(market.jobExpiration) : null,
    jobType: market.jobType != null ? Number(market.jobType) & ~MARKET_RESTRICTED_FLAG : null,
    ...(settings !== undefined && {
      settingsAddress: settings?.address.toString() ?? null,
      projectAccessKey: settings?.projectAccessKey.toString() ?? null,
    }),
    updatedAt: now,
  };
}

// Helper function to compare job from database with Job from nosana/kit
export function jobsAreEqual(dbJob: SelectJob, nosanaJob: Job): boolean {
  // Compare core job properties
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

// Helper function to convert Job (full or partial) from @nosana/kit to InsertJobAccount for database
export function convertJobToInsertJob(
  job: Job | (Partial<Job> & { address: Job["address"] }),
): InsertJob | (Partial<InsertJob> & { address: InsertJob["address"] }) {
  const result: Partial<InsertJob> & {
    address: InsertJob["address"];
  } = {
    address: job.address.toString(),
  };

  // Handle all possible Job properties, checking if they exist and are defined
  if ("ipfsJob" in job && job.ipfsJob !== undefined) {
    result.ipfsJob = job.ipfsJob;
  }
  if ("ipfsResult" in job && job.ipfsResult !== undefined) {
    result.ipfsResult = job.ipfsResult;
  }
  if ("market" in job && job.market !== undefined) {
    result.market = job.market.toString();
  }
  if ("node" in job && job.node !== undefined) {
    result.node = job.node.toString();
  }
  if ("payer" in job && job.payer !== undefined) {
    result.payer = job.payer.toString();
  }
  if ("price" in job && job.price !== undefined) {
    result.price = Number(job.price);
  }
  if ("project" in job && job.project !== undefined) {
    result.project = job.project.toString();
  }
  if ("state" in job && job.state !== undefined) {
    result.state = job.state;
  }
  if ("timeEnd" in job && job.timeEnd !== undefined) {
    result.timeEnd = Number(job.timeEnd);
  }
  if ("timeStart" in job && job.timeStart !== undefined) {
    result.timeStart = Number(job.timeStart);
  }
  if ("timeout" in job && job.timeout !== undefined) {
    result.timeout = Number(job.timeout);
  }

  return result;
}

// Helper function to check if a job exists on-chain
// Returns true if the job exists, false if it doesn't exist
export async function checkJobExists(
  nosanaClient: NosanaClient,
  jobAddress: string,
): Promise<boolean> {
  try {
    await nosanaClient.jobs.get(address(jobAddress));
    return true;
  } catch (e: unknown) {
    if (
      e &&
      typeof e === "object" &&
      "message" in e &&
      typeof e.message === "string" &&
      (e.message.includes("Account does not exist or has no data") ||
        e.message.includes("Account not found at address"))
    ) {
      return false;
    }
    // Re-throw other errors
    throw e;
  }
}

// Helper function to pause execution for a specified number of seconds
export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
