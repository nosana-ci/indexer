import { type NosanaClient, JobsClient } from "@nosana/kit";
import type { KeyPairSigner, Address, Instruction } from "@solana/kit";
import JobsRepository from "../repositories/jobs.repository";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "job-cleaner" });

const BATCH_SIZE = 15;
const MAX_JOBS_FROM_CHAIN = 250;
const MAX_JOBS_TO_CLEAN = 150;
const COMPLETED_WITH_RESULT_AGE_MS = 1 * 60 * 60 * 1000; // 1 hour
const COMPLETED_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const TX_DELAY_MS = 150;
const MAX_RETRIES = 2;

export default class JobCleanerService {
  private readonly jobsRepo = new JobsRepository();

  constructor(
    private readonly nosanaClient: NosanaClient,
    private readonly adminSigner: KeyPairSigner,
  ) {
    this.nosanaClient.wallet = adminSigner;
  }

  async cleanJobs(): Promise<void> {
    try {
      logger.info("Retrieving completed jobs from blockchain");

      let blockchainJobs = await this.nosanaClient.jobs.all({ state: 2 });
      logger.info({ count: blockchainJobs.length }, "Found completed on-chain jobs");

      blockchainJobs = blockchainJobs.reverse().slice(0, MAX_JOBS_FROM_CHAIN);

      const now = Date.now();
      const dbJobs = await this.jobsRepo.findCompletedForCleaning(
        blockchainJobs.map((j) => j.address),
        Math.round((now - COMPLETED_WITH_RESULT_AGE_MS) / 1000),
        Math.round((now - COMPLETED_AGE_MS) / 1000),
        MAX_JOBS_TO_CLEAN,
      );

      if (dbJobs.length === 0) {
        logger.info("No jobs to clean");
        return;
      }

      logger.info({ count: dbJobs.length }, "Found jobs eligible for cleaning");

      const batches = this.chunkArray(dbJobs, BATCH_SIZE);

      if (batches.length > 1) {
        logger.info({ batches: batches.length }, "Split into multiple clean transactions");
      }

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        await new Promise((r) => setTimeout(r, TX_DELAY_MS));

        const instructions: Instruction[] = [];

        for (const job of batch) {
          try {
            const ix = JobsClient.getCleanAdminInstruction({
              job: job.address as Address,
              payer: job.payer as Address,
              authority: this.adminSigner,
            });
            instructions.push(ix);
          } catch (e) {
            logger.error({ err: e, job: job.address }, "Failed to create clean instruction");
          }
        }

        if (instructions.length === 0) continue;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            logger.info({ batch: batchIdx + 1 }, "Sending clean transaction");
            const signature = await this.nosanaClient.solana.buildSignAndSend(instructions);
            logger.info({ batch: batchIdx + 1, signature }, "Clean transaction succeeded");
            break;
          } catch (e: unknown) {
            const error = e instanceof Error ? e : new Error(String(e));
            if (attempt === MAX_RETRIES - 1 || error.message?.includes("AccountNotInitialized")) {
              logger.error({ err: e, batch: batchIdx + 1 }, "Clean transaction failed");
              break;
            }
            logger.info({ batch: batchIdx + 1 }, "Clean transaction failed, retrying");
          }
        }
      }

      logger.info("Done cleaning jobs");
    } catch (error) {
      logger.error({ err: error }, "Error cleaning jobs");
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
