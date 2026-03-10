import {
  type NosanaClient,
  type Job,
  JobState,
  MarketQueueType,
  MonitorEventType,
  address,
  type Market,
  type Run,
  type FlowState,
  type JobDefinition,
} from "@nosana/kit";
import type { InsertJob, SelectJob } from "../db/tables/jobs";
import { jobsAreEqual, convertJobToInsertJob, checkJobExists, sleep } from "./utils";
import { getNosPrice } from "../services/price.service";
import JobsRepository from "../repositories/jobs.repository";
import DailyEarningsRepository from "../repositories/daily-earnings.repository";
import DailyJobSpendRepository from "../repositories/daily-job-spend.repository";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "indexer" });

export class Indexer {
  private nosanaClient: NosanaClient;
  private jobsRepo: JobsRepository;
  private dailyEarningsRepo: DailyEarningsRepository;
  private dailyJobSpendRepo: DailyJobSpendRepository;
  private _isRunning: boolean = false;
  private _lastActivity: Date = new Date();
  private _startTime: Date | null = null;
  private _stopMonitor: (() => void) | null = null;

  constructor(
    nosanaClient: NosanaClient,
    jobsRepo?: JobsRepository,
    dailyEarningsRepo?: DailyEarningsRepository,
    dailyJobSpendRepo?: DailyJobSpendRepository,
  ) {
    this.nosanaClient = nosanaClient;
    this.jobsRepo = jobsRepo || new JobsRepository();
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
          logger.debug({ address: event.data.address }, "JobAccount change");
          const updatedJob = await this.handleJobUpdate(event.data);
          if (updatedJob) {
            logger.debug({ address: updatedJob.address }, "WebSocket updated/inserted job account data");
          }
        } else if (event.type === MonitorEventType.MARKET) {
          logger.debug({ address: event.data.address }, "MarketAccount change");
          await this.handleMarketUpdate(event.data);
        } else if (event.type === MonitorEventType.RUN) {
          logger.debug({ address: event.data.address }, "RunAccount change");
          const updatedJob = await this.handleRunUpdate(event.data);
          if (updatedJob) {
            logger.debug({ address: updatedJob.address }, "WebSocket updated/inserted job account data");
          }
        }
      }
    })().catch((error) => {
      logger.error({ err: error }, "Monitor event stream error");
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
      logger.error({ runAddress: runAccount.address }, "Could not get job account data from run account");
      return null;
    }
    logger.debug({ jobAddress: jobFromRun.address, runAddress: runAccount.address }, "Found job belonging to run");
    jobFromRun = {
      ...jobFromRun,
      state: 1,
      timeStart: runAccount.time,
      node: runAccount.node,
    };
    return this.handleJobUpdate(jobFromRun);
  }

  async handleMarketUpdate(marketAccount: Market): Promise<void> {
    const queuedJobsFromDB = await this.jobsRepo.findQueuedByMarket(
      marketAccount.address.toString(),
    );

    // Check if all our queued jobs in this market are actually still queued on-chain
    // A delist instruction can remove the job from the on-chain queue
    if (queuedJobsFromDB && queuedJobsFromDB.length) {
      let removeJobsFromDb: string[];
      if (marketAccount.queueType === MarketQueueType.NODE_QUEUE || !marketAccount.queue.length) {
        removeJobsFromDb = queuedJobsFromDB.map((j) => j.address);
      } else {
        // Check which jobs are not in queue anymore
        removeJobsFromDb = queuedJobsFromDB
          .filter((j) => !marketAccount.queue.includes(address(j.address)))
          .map((j) => j.address);
      }
      if (removeJobsFromDb.length) {
        // Double check if these jobs really don't exist on-chain anymore before deleting them
        for (let i = 0; i < removeJobsFromDb.length; i++) {
          try {
            const exists = await checkJobExists(this.nosanaClient, removeJobsFromDb[i]);
            if (!exists) {
              logger.info({ job: removeJobsFromDb[i] }, "Queued job not found on-chain, removing from db");
              await this.jobsRepo.delete(removeJobsFromDb[i]);
            }
          } catch (e: unknown) {
            logger.error({ err: e }, "Could not check job account on-chain");
          }
        }
      }
    }
  }

  private async handleJobUpdate(job: Job): Promise<SelectJob | null> {
    const existingJobData = await this.jobsRepo.findByAddress(job.address.toString());

    if (!existingJobData || !jobsAreEqual(existingJobData, job)) {
      // Don't update if the new job state is smaller or the same
      if (
        existingJobData &&
        existingJobData.state >= (job.state as number) &&
        existingJobData.timeout >= job.timeout &&
        existingJobData.ipfsResult === job.ipfsResult
      ) {
        logger.debug(
          { job: job.address.toString(), newState: job.state, oldState: existingJobData.state },
          "Skipped update as new state is smaller or same with no timeout or result update",
        );
        return null;
      }
      // If we have existing job data and only the timeout is higher, do a partial update
      let newJob: SelectJob | null;
      if (existingJobData) {
        const updateData: Partial<Job> & { address: Job["address"] } = job;
        if (job.state < existingJobData.state) {
          // this scenario might happen for when we have an extend for a running job
          delete updateData.state;
          delete updateData.node;
          delete updateData.timeStart;
        }
        newJob = await this.updateJob(updateData);
      } else {
        newJob = await this.insertOrUpdateJob(job);
      }
      if (newJob) {
        // Optional: Process the job immediately after insert/update (non-blocking)
        this.processJob(newJob)
          .then(() => {
            logger.debug({ job: newJob.address }, "Immediately processed job");
          })
          .catch((error) => {
            logger.error({ err: error, job: newJob.address }, "Failed to immediately process job");
          });

        if (
          newJob.state === JobState.COMPLETED &&
          (!existingJobData || existingJobData.state !== JobState.COMPLETED)
        ) {
          this.updateDailyTables(newJob).then(() => {
            logger.debug({ job: newJob.address }, "Updated daily tables for completed job");
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
        // Format UTC date as YYYY-MM-DD
        const jobDate = new Date(job.timeEnd * 1000).toISOString().split("T")[0];

        // Calculate NOS earnings for the node
        const durationSeconds = Math.min(job.timeEnd - job.timeStart, job.timeout as number);

        // Calculate USD earnings for the node
        const durationHours = durationSeconds / 3600;
        const totalUsdEarned = durationHours * (job.usdRewardPerHour || 0);

        // Update daily_earnings for the node (in USD) using recalculation
        await this.dailyEarningsRepo.upsertWithRecalculation({
          date: jobDate,
          node: job.node,
          market: job.market,
          totalEarnedUsd: totalUsdEarned,
        });

        // Update daily spent for the project (repository will use market rate if job rate is NULL)
        await this.dailyJobSpendRepo.upsertWithRecalculation({
          date: jobDate,
          project: job.project,
          market: job.market,
          totalSpent: totalUsdEarned,
        });
      } catch (error) {
        logger.error({ err: error, job: job.address }, "Error updating daily tables");
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
          logger.debug(
            { index, total: accounts.length, address: updatedJob.address },
            "JOBS GPA updated/inserted account data",
          );
        }
      }

      logger.info({ inserted, total: accounts.length }, "JOBS GPA completed");
    } catch (e) {
      logger.error({ err: e }, "Error in jobsGPA");
    }
  }

  async marketsGPA() {
    try {
      const markets = await this.nosanaClient.jobs.markets();
      logger.info({ count: markets.length }, "MARKETS GPA processing");

      for (const [index, market] of markets.entries()) {
        logger.debug(
          { index: index + 1, total: markets.length, address: market.address },
          "MARKETS GPA processing market",
        );
        await this.handleMarketUpdate(market);
      }

      logger.info({ count: markets.length }, "MARKETS GPA completed");
    } catch (e) {
      logger.error({ err: e }, "Error in marketsGPA");
    }
  }

  async processJobs() {
    try {
      const jobsToProcess: SelectJob[] = await this.jobsRepo.findJobsToProcess({
        limit: 500,
        minTimeEnd: 1727690400, // TG3 cutoff date
      });

      if (!jobsToProcess.length) {
        logger.info("No jobs to process");
        return;
      }

      logger.info({ count: jobsToProcess.length }, "Processing jobs");

      for (const [index, job] of jobsToProcess.entries()) {
        logger.debug(
          { index: index + 1, total: jobsToProcess.length, job: job.address },
          "Processing job",
        );

        try {
          const processed = await this.processJob(job);
          if (processed) {
            logger.debug({ job: job.address }, "Successfully processed job");
          }
        } catch (error) {
          logger.error({ err: error, job: job.address }, "Failed to process job");
        }
      }

      logger.info({ count: jobsToProcess.length }, "Completed processing jobs");
    } catch (e) {
      logger.error({ err: e }, "Error in processJobs");
    }
  }

  private async processJob(job: SelectJob): Promise<boolean> {
    logger.debug({ job: job.address, state: job.state }, "Processing job");

    // Prepare update data object
    const updateData: Partial<InsertJob> = {};
    if (job.listedAt === null) {
      try {
        const signatures = await this.nosanaClient.solana.rpc
          .getSignaturesForAddress(address(job.address))
          .send();
        const listSignature = signatures[signatures.length - 1]; // First transaction
        if (listSignature && listSignature.blockTime) {
          updateData.listedAt = Number(listSignature.blockTime);
        } else {
          logger.debug({ job: job.address }, "No transaction found for job");
        }
      } catch (error) {
        logger.error({ err: error, job: job.address }, "Cannot retrieve list transaction for job");
      }
    }
    const listedAt = job.listedAt || updateData.listedAt;

    if (listedAt && job.usdRewardPerHour === null) {
      try {
        // Get the NOS price at the job's timeStart
        const nosPrice = await getNosPrice(listedAt);

        if (nosPrice !== null) {
          // Calculate USD reward per hour
          // job.price is in NOS tokens per second, nosPrice is USD per NOS
          // Convert to USD per hour: price * nosPrice * 3600 seconds
          const usdRewardPerHour = (job.price / 1e6) * nosPrice * 3600; // Divide by 1e6 to convert from lamports to NOS
          updateData.usdRewardPerHour = usdRewardPerHour;
          this.updateDailyTables(job).then(() => {
            logger.debug({ job: job.address }, "Updated daily tables for completed job");
          });
        } else {
          logger.debug({ job: job.address, listedAt }, "Could not get NOS price for job");
        }
      } catch (error) {
        logger.error({ err: error, job: job.address }, "Error calculating usdRewardPerHour");
      }
    }

    // Handle job definition retrieval
    if (!job.jobDefinition && job.ipfsJob) {
      try {
        const jobDefinition: JobDefinition = await this.nosanaClient.ipfs.retrieve(job.ipfsJob);
        // to prevent pinita rate limits
        await sleep(0.5);
        const newJobType = jobDefinition?.meta?.trigger ?? null;

        updateData.jobDefinition = JSON.stringify(jobDefinition);
        updateData.type = newJobType;

        logger.debug({ job: job.address, type: newJobType }, "Retrieved job definition");
      } catch (error) {
        logger.error({ err: error, job: job.address }, "Cannot retrieve job definition");
      }
    }

    // Handle job result retrieval
    if (
      job.ipfsResult &&
      !job.jobResult &&
      // only jobs from the 30th of September 2024, start of TG3
      job.timeEnd > 1727690400 &&
      job.state === 2
    ) {
      try {
        const result: FlowState = await this.nosanaClient.ipfs.retrieve(job.ipfsResult);
        // to prevent pinita rate limits
        await sleep(0.5);
        // remove logs from all opStates
        if (result.opStates) {
          const opStates = result.opStates.map(({ logs: _logs, ...keepAttrs }) => ({
            ...keepAttrs,
            logs: [],
          }));
          result.opStates = opStates;
        }

        updateData.jobResult = result;
        if (result.status) {
          updateData.jobStatus = result.status;
        }

        logger.debug({ job: job.address, status: result.status }, "Retrieved job result");
      } catch (error: unknown) {
        logger.error({ err: error, job: job.address }, "Could not process job results");
      }
    }

    // Only update database if we have data to update
    if (Object.keys(updateData).length > 0) {
      try {
        await this.jobsRepo.simpleUpdate(job.address, updateData);

        logger.debug({ job: job.address, fields: Object.keys(updateData) }, "Updated job");
        return true;
      } catch (error) {
        logger.error({ err: error, job: job.address }, "Failed to update job");
      }
    }
    return false;
  }

  async insertOrUpdateJob(job: Job): Promise<SelectJob> {
    const jobValues = convertJobToInsertJob(job) as InsertJob;
    return await this.jobsRepo.upsert(jobValues);
  }

  async updateJob(job: Partial<Job> & { address: Job["address"] }): Promise<SelectJob | null> {
    const jobValues = convertJobToInsertJob(job);
    return await this.jobsRepo.update(jobValues.address, jobValues);
  }
}
