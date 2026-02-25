import { type NosanaClient, JobsClient } from '@nosana/kit';
import type { KeyPairSigner, Address, Instruction } from '@solana/kit';
import JobsRepository from '../repositories/jobs.repository';

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
    private readonly adminSigner: KeyPairSigner
  ) {
    this.nosanaClient.wallet = adminSigner;
  }

  async cleanJobs(): Promise<void> {
    try {
      console.log('Retrieving completed jobs from blockchain...');

      let blockchainJobs = await this.nosanaClient.jobs.all({ state: 2 });
      console.log(`Found ${blockchainJobs.length} completed on-chain jobs`);

      blockchainJobs = blockchainJobs.reverse().slice(0, MAX_JOBS_FROM_CHAIN);

      const now = Date.now();
      const dbJobs = await this.jobsRepo.findCompletedForCleaning(
        blockchainJobs.map((j) => j.address),
        Math.round((now - COMPLETED_WITH_RESULT_AGE_MS) / 1000),
        Math.round((now - COMPLETED_AGE_MS) / 1000),
        MAX_JOBS_TO_CLEAN
      );

      if (dbJobs.length === 0) {
        console.log('No jobs to clean');
        return;
      }

      console.log(`Found ${dbJobs.length} jobs eligible for cleaning`);

      const batches = this.chunkArray(dbJobs, BATCH_SIZE);

      if (batches.length > 1) {
        console.log(`Split into ${batches.length} clean transactions`);
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
            console.error(
              `Failed to create clean instruction for job ${job.address}:`,
              e
            );
          }
        }

        if (instructions.length === 0) continue;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            console.log(`Sending clean transaction #${batchIdx + 1}...`);
            const signature =
              await this.nosanaClient.solana.buildSignAndSend(instructions);
            console.log(`Clean transaction #${batchIdx + 1} succeeded: ${signature}`);
            break;
          } catch (e: any) {
            if (
              attempt === MAX_RETRIES - 1 ||
              e?.message?.includes('AccountNotInitialized')
            ) {
              console.error(
                `Clean transaction #${batchIdx + 1} failed:`,
                e
              );
              break;
            }
            console.log(
              `Clean transaction #${batchIdx + 1} failed, retrying...`
            );
          }
        }
      }

      console.log('Done cleaning jobs');
    } catch (error) {
      console.error('Error cleaning jobs:', error);
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
