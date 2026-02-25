import {
  type NosanaClient,
  type Job,
  JobState,
  MarketQueueType,
  MonitorEventType,
  address,
  type Market,
  type Run,
} from '@nosana/kit';
import type { InsertJob, SelectJob } from '../db/tables/jobs';
import {
  jobsAreEqual,
  convertJobToInsertJob,
  checkJobExists,
  sleep,
} from './utils';
import { getNosPrice } from '../services/price.service';
import JobAccountsRepository from '../repositories/job-accounts.repository';
import DailyEarningsRepository from '../repositories/daily-earnings.repository';
import DailyJobSpendRepository from '../repositories/daily-job-spend.repository';

export class Indexer {
  private nosanaClient: NosanaClient;
  private jobAccountsRepo: JobAccountsRepository;
  private dailyEarningsRepo: DailyEarningsRepository;
  private dailyJobSpendRepo: DailyJobSpendRepository;
  private _isRunning: boolean = false;
  private _lastActivity: Date = new Date();
  private _startTime: Date | null = null;
  private _stopMonitor: (() => void) | null = null;

  constructor(
    nosanaClient: NosanaClient,
    jobAccountsRepo?: JobAccountsRepository,
    dailyEarningsRepo?: DailyEarningsRepository,
    dailyJobSpendRepo?: DailyJobSpendRepository
  ) {
    this.nosanaClient = nosanaClient;
    this.jobAccountsRepo = jobAccountsRepo || new JobAccountsRepository();
    this.dailyEarningsRepo = dailyEarningsRepo || new DailyEarningsRepository();
    this.dailyJobSpendRepo = dailyJobSpendRepo || new DailyJobSpendRepository();
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get lastActivity(): Date {
    return this._lastActivity;
  }

  get startTime(): Date | null {
    return this._startTime;
  }

  get healthStatus() {
    return {
      isRunning: this._isRunning,
      lastActivity: this._lastActivity,
      startTime: this._startTime,
      uptime: this._startTime ? Date.now() - this._startTime.getTime() : 0,
    };
  }

  private updateActivity() {
    this._lastActivity = new Date();
  }

  async start() {
    this._startTime = new Date();
    this._isRunning = true;
    this.updateActivity();

    await this.jobsGPA();
    await this.marketsGPA();

    const [eventStream, stop] = await this.nosanaClient.jobs.monitorDetailed();
    this._stopMonitor = stop;

    // Process events in background
    (async () => {
      for await (const event of eventStream) {
        this.updateActivity();

        if (event.type === MonitorEventType.JOB) {
          console.log('JobAccount change:', event.data.address);
          const updatedJob = await this.handleJobUpdate(event.data);
          if (updatedJob) {
            console.log(
              `(WebSocket) Updated/Inserted job account data for ${updatedJob.address}`
            );
          }
        } else if (event.type === MonitorEventType.MARKET) {
          console.log('MarketAccount change:', event.data.address);
          await this.handleMarketUpdate(event.data);
        } else if (event.type === MonitorEventType.RUN) {
          console.log('RunAccount change:', event.data.address);
          const updatedJob = await this.handleRunUpdate(event.data);
          if (updatedJob) {
            console.log(
              `(WebSocket) Updated/Inserted job account data for ${updatedJob.address}`
            );
          }
        }
      }
    })().catch((error) => {
      console.error('Monitor event stream error:', error);
    });
  }

  stop() {
    this._isRunning = false;
    this._startTime = null;
    if (this._stopMonitor) {
      this._stopMonitor();
      this._stopMonitor = null;
    }
  }

  async handleRunUpdate(runAccount: Run): Promise<SelectJob | null> {
    let jobFromRun = await this.nosanaClient.jobs.get(runAccount.job, false);
    if (!jobFromRun) {
      console.error(
        `(WebSocket) Could not get job account data from run account ${runAccount.address}`
      );
      return null;
    }
    console.log(
      `(WebSocket) Found job ${jobFromRun.address} belonging to run ${runAccount.address}`
    );
    jobFromRun = {
      ...jobFromRun,
      state: 1,
      timeStart: runAccount.time,
      node: runAccount.node,
    };
    return this.handleJobUpdate(jobFromRun);
  }

  async handleMarketUpdate(marketAccount: Market): Promise<void> {
    const queuedJobsFromDB = await this.jobAccountsRepo.findQueuedByMarket(
      marketAccount.address.toString()
    );

    if (queuedJobsFromDB && queuedJobsFromDB.length) {
      let removeJobsFromDb: string[] = [];
      if (
        marketAccount.queueType === MarketQueueType.NODE_QUEUE ||
        !marketAccount.queue.length
      ) {
        removeJobsFromDb = queuedJobsFromDB.map((j) => j.address);
      } else {
        removeJobsFromDb = queuedJobsFromDB
          .filter((j) => !marketAccount.queue.includes(address(j.address)))
          .map((j) => j.address);
      }
      if (removeJobsFromDb.length) {
        for (let i = 0; i < removeJobsFromDb.length; i++) {
          try {
            const exists = await checkJobExists(
              this.nosanaClient,
              removeJobsFromDb[i]
            );
            if (!exists) {
              console.log(
                `Could not find queued job ${removeJobsFromDb[i]} on-chain, it was probably delisted, removing from db..`
              );
              await this.jobAccountsRepo.delete(removeJobsFromDb[i]);
            }
          } catch (e: unknown) {
            console.log('Could not check job account on-chain', e);
          }
        }
      }
    }
  }

  private async handleJobUpdate(job: Job): Promise<SelectJob | null> {
    const existingJobData = await this.jobAccountsRepo.findByAddress(
      job.address.toString()
    );

    if (!existingJobData || !jobsAreEqual(existingJobData, job)) {
      if (
        existingJobData &&
        existingJobData.state >= (job.state as number) &&
        existingJobData.timeout >= job.timeout &&
        existingJobData.ipfsResult === job.ipfsResult
      ) {
        console.log(
          `Skipped update as new state ${job.state} is smaller or same as old state ${existingJobData.state} with no timeout or result update`
        );
        return null;
      }

      let newJob: SelectJob | null;
      if (existingJobData) {
        const updateData: Partial<Job> & { address: Job['address'] } = { ...job };
        if (job.state < existingJobData.state) {
          delete (updateData as any).state;
          delete (updateData as any).node;
          delete (updateData as any).timeStart;
        }
        newJob = await this.updateJob(updateData);
      } else {
        newJob = await this.insertOrUpdateJob(job);
      }
      if (newJob) {
        this.processJob(newJob)
          .then(() => {
            console.log(`Immediately processed job ${newJob.address}`);
          })
          .catch((error) => {
            console.error(
              `Failed to immediately process job ${newJob.address}:`,
              error
            );
          });

        if (
          newJob.state === JobState.COMPLETED &&
          (!existingJobData || existingJobData.state !== JobState.COMPLETED)
        ) {
          this.updateDailyTables(newJob).then(() => {
            console.log(
              `Updated daily tables for completed job ${newJob.address}`
            );
          });
        }
      }
      return newJob;
    }
    return null;
  }

  private async updateDailyTables(job: SelectJob): Promise<void> {
    if (job.state === JobState.COMPLETED) {
      try {
        const jobDate = new Date(job.timeEnd * 1000)
          .toISOString()
          .split('T')[0];

        const durationSeconds = Math.min(
          job.timeEnd - job.timeStart,
          job.timeout as number
        );

        const durationHours = durationSeconds / 3600;
        const totalUsdEarned = durationHours * (job.usdRewardPerHour || 0);

        await this.dailyEarningsRepo.upsertWithRecalculation({
          date: jobDate,
          node: job.node,
          market: job.market,
          totalEarnedUsd: totalUsdEarned,
        });

        await this.dailyJobSpendRepo.upsertWithRecalculation({
          date: jobDate,
          project: job.project,
          market: job.market,
          totalSpent: totalUsdEarned,
        });
      } catch (error) {
        console.error(`Error updating daily tables for job ${job.address}:`, error);
      }
    }
  }

  async jobsGPA() {
    try {
      const accounts = await this.nosanaClient.jobs.all(undefined, true);
      let inserted = 0;

      for (const [index, job] of accounts.entries()) {
        const updatedJob = await this.handleJobUpdate(job);
        if (updatedJob) {
          inserted++;
          console.log(
            `(JOBS GPA ${index}/${accounts.length}) Updated/Inserted account data for ${updatedJob.address}`
          );
        }
      }

      console.log(
        `(JOBS GPA) Updated/Inserted ${inserted} out of ${accounts.length} jobs`
      );
    } catch (e) {
      console.error('Error in jobsGPA:', e);
    }
  }

  async marketsGPA() {
    try {
      const marketsList = await this.nosanaClient.jobs.markets();
      console.log(`(MARKETS GPA) Processing ${marketsList.length} markets`);

      for (const [index, market] of marketsList.entries()) {
        console.log(
          `(MARKETS GPA ${index + 1}/${marketsList.length}) Processing market ${market.address}`
        );
        await this.handleMarketUpdate(market);
      }

      console.log(`(MARKETS GPA) Processed ${marketsList.length} markets`);
    } catch (e) {
      console.error('Error in marketsGPA:', e);
    }
  }

  async processJobs() {
    try {
      const jobsToProcess: SelectJob[] =
        await this.jobAccountsRepo.findJobsToProcess({
          limit: 500,
          minTimeEnd: 1727690400,
        });

      if (!jobsToProcess.length) {
        console.log('(PROCESS JOBS) No jobs to process');
        return;
      }

      console.log(`(PROCESS JOBS) Processing ${jobsToProcess.length} jobs`);

      for (const [index, job] of jobsToProcess.entries()) {
        console.log(
          `(PROCESS JOBS ${index + 1}/${jobsToProcess.length}) Processing job ${job.address}`
        );

        try {
          const processed = await this.processJob(job);
          if (processed) {
            console.log(
              `(PROCESS JOBS) Successfully processed job ${job.address}`
            );
          }
        } catch (error) {
          console.error(
            `(PROCESS JOBS) Failed to process job ${job.address}:`,
            error
          );
        }
      }

      console.log(
        `(PROCESS JOBS) Completed processing ${jobsToProcess.length} jobs`
      );
    } catch (e) {
      console.error('Error in processJobs:', e);
    }
  }

  private async processJob(job: SelectJob): Promise<boolean> {
    console.log(`Processing job ${job.address} with state ${job.state}`);

    const updateData: Partial<InsertJob> = {};
    if (job.listedAt === null) {
      try {
        const signatures = await this.nosanaClient.solana.rpc
          .getSignaturesForAddress(address(job.address))
          .send();
        const listSignature = signatures[signatures.length - 1];
        if (listSignature && listSignature.blockTime) {
          updateData.listedAt = Number(listSignature.blockTime);
        } else {
          console.log(`no transaction found for job ${job.address}`);
        }
      } catch (error) {
        console.log(
          `cant retrieve list transaction for job ${job.address}, ${error}`
        );
      }
    }
    const listedAt = job.listedAt || updateData.listedAt;

    if (listedAt && job.usdRewardPerHour === null) {
      try {
        const nosPrice = await getNosPrice(listedAt);

        if (nosPrice !== null) {
          const usdRewardPerHour = (job.price / 1e6) * nosPrice * 3600;
          updateData.usdRewardPerHour = usdRewardPerHour;
        } else {
          console.log(
            `Could not get NOS price for job ${job.address} at listedAt ${listedAt}`
          );
        }
      } catch (error) {
        console.error(
          `Error calculating usdRewardPerHour for job ${job.address}:`,
          error
        );
      }
    }

    if (!job.jobDefinition && job.ipfsJob) {
      try {
        const jobDefinition: any = await this.nosanaClient.ipfs.retrieve(
          job.ipfsJob
        );
        await sleep(0.5);
        const newJobType =
          jobDefinition?.meta?.trigger ?? null;

        updateData.jobDefinition = JSON.stringify(jobDefinition);
        updateData.type = newJobType;

        console.log(
          `Retrieved job definition for ${job.address} with type: ${newJobType}`
        );
      } catch (error) {
        console.log(
          `cant retrieve job definition of job ${job.address}, ${error}`
        );
      }
    }

    if (
      job.ipfsResult &&
      !job.jobResult &&
      job.timeEnd > 1727690400 &&
      job.state === 2
    ) {
      try {
        const result: any = await this.nosanaClient.ipfs.retrieve(job.ipfsResult);
        await sleep(0.5);
        if (result.opStates) {
          const opStates = result.opStates.map(
            ({ logs, ...keepAttrs }: any) => keepAttrs
          );
          result.opStates = opStates;
        }

        updateData.jobResult = result;
        if (result.status) {
          updateData.jobStatus = result.status;
        }

        console.log(
          `Retrieved job result for ${job.address} with status: ${result.status}`
        );
      } catch (error: any) {
        console.error('couldnt process job results ', job.address);
        console.error(error.message);
      }
    }

    if (Object.keys(updateData).length > 0) {
      try {
        await this.jobAccountsRepo.simpleUpdate(job.address, updateData);

        console.log(
          `Updated job ${job.address} with:`,
          Object.keys(updateData).join(', ')
        );
        return true;
      } catch (error) {
        console.error(`Failed to update job ${job.address}:`, error);
      }
    }
    return false;
  }

  async insertOrUpdateJob(job: Job): Promise<SelectJob> {
    const jobValues = convertJobToInsertJob(job) as InsertJob;
    return await this.jobAccountsRepo.upsert(jobValues);
  }

  async updateJob(
    job: Partial<Job> & { address: Job['address'] }
  ): Promise<SelectJob | null> {
    const jobValues = convertJobToInsertJob(job);
    return await this.jobAccountsRepo.update(jobValues.address, jobValues);
  }
}
