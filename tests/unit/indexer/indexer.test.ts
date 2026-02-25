/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockAddress,
  createTestJobAccount,
  createTestNosanaJob,
  createTestNosanaMarket,
  createTestNosanaRun,
  testIpfsMetaTriggerGithub,
  testIpfsResultHash,
  jobCompletedState,
  jobQueuedState,
  jobRunningState,
  marketQueueJobType,
  marketQueueNodeType,
  secondsInAnHour,
  secondsInTwoHours,
  testIpfsJobHash,
  testJobAddress,
  testMarketAddress,
  testNodeAddress,
  testPayerAddress,
  testProjectAddress,
  ipfsSuccessStatus,
  indexerBoundaryValues,
} from '../../utils/test-data.factory';
import { createMockNosanaClient } from '../../mocks/external-apis.mock';
import { Indexer } from '../../../src/indexer/indexer';
import { checkJobExists } from '../../../src/indexer/utils';
import { getNosPrice } from '../../../src/services/price.service';

const job1Address = 'Job1';
const job2Address = 'Job2';
const marketAddress1 = 'Market1';
const marketAddress2 = 'Market2';
const ipfsJobHash1 = 'QmHash1';
const ipfsJobHash2 = 'QmHash2';

const rpcErrorMessage = 'RPC error';
const dbErrorMessage = 'DB error';

async function* emptyAsyncIterable() {}
function noop() {}

// Mock @nosana/kit module
vi.mock('@nosana/kit', () => ({
  address: (addr: string) => ({ toString: () => addr }),
  JobState: {
    QUEUED: jobQueuedState,
    RUNNING: jobRunningState,
    COMPLETED: jobCompletedState,
  },
  MarketQueueType: {
    NODE_QUEUE: marketQueueNodeType,
  },
  MonitorEventType: {
    JOB: 'job',
    MARKET: 'market',
    RUN: 'run',
  },
}));

// Mock price service
vi.mock('../../../src/services/price.service', () => ({
  getNosPrice: vi.fn(),
}));

// Mock indexer utils (sleep, checkJobExists)
vi.mock('../../../src/indexer/utils', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
    checkJobExists: vi.fn().mockResolvedValue(true),
  };
});

// Mock repositories
const mockJobAccountsRepo = {
  findByAddress: vi.fn(),
  findQueuedByMarket: vi.fn(),
  findJobsToProcess: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  simpleUpdate: vi.fn(),
  delete: vi.fn(),
};

const mockDailyEarningsRepo = {
  upsertWithRecalculation: vi.fn(),
};

const mockDailyJobSpendRepo = {
  upsertWithRecalculation: vi.fn(),
};

vi.mock('../../../src/repositories/jobs.repository', () => ({
  default: class MockJobsRepository {
    findByAddress = mockJobAccountsRepo.findByAddress;
    findQueuedByMarket = mockJobAccountsRepo.findQueuedByMarket;
    findJobsToProcess = mockJobAccountsRepo.findJobsToProcess;
    upsert = mockJobAccountsRepo.upsert;
    update = mockJobAccountsRepo.update;
    simpleUpdate = mockJobAccountsRepo.simpleUpdate;
    delete = mockJobAccountsRepo.delete;
  },
}));

vi.mock('../../../src/repositories/daily-earnings.repository', () => ({
  default: class MockDailyEarningsRepository {
    upsertWithRecalculation = mockDailyEarningsRepo.upsertWithRecalculation;
  },
}));

vi.mock('../../../src/repositories/daily-job-spend.repository', () => ({
  default: class MockDailyJobSpendRepository {
    upsertWithRecalculation = mockDailyJobSpendRepo.upsertWithRecalculation;
  },
}));

describe('Indexer', () => {
  let indexer: Indexer;
  let mockNosanaClient: ReturnType<typeof createMockNosanaClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNosanaClient = createMockNosanaClient();
    mockNosanaClient.jobs.monitorDetailed.mockResolvedValue([
      emptyAsyncIterable(),
      noop,
    ]);

    // Reset mock returns to default values
    mockJobAccountsRepo.findByAddress.mockResolvedValue(null);
    mockJobAccountsRepo.findQueuedByMarket.mockResolvedValue([]);
    mockJobAccountsRepo.findJobsToProcess.mockResolvedValue([]);
    mockJobAccountsRepo.upsert.mockResolvedValue(createTestJobAccount());
    mockJobAccountsRepo.update.mockResolvedValue(createTestJobAccount());
    mockJobAccountsRepo.simpleUpdate.mockResolvedValue(undefined);
    mockDailyEarningsRepo.upsertWithRecalculation.mockResolvedValue(undefined);
    mockDailyJobSpendRepo.upsertWithRecalculation.mockResolvedValue(undefined);
    vi.mocked(getNosPrice).mockResolvedValue(0.5);

    // Create indexer with mocked repositories
    indexer = new Indexer(
      mockNosanaClient as any,
      mockJobAccountsRepo as any,
      mockDailyEarningsRepo as any,
      mockDailyJobSpendRepo as any
    );
  });

  describe('constructor', () => {
    it('should initialize with NosanaClient and repositories', () => {
      expect(indexer).toBeDefined();
      expect(indexer.isRunning).toBeFalsy();
    });

    it('should create default repositories when not provided', () => {
      const indexerWithDefaults = new Indexer(mockNosanaClient as any);
      expect(indexerWithDefaults).toBeDefined();
    });

    it('should set initial state correctly', () => {
      expect(indexer.isRunning).toBeFalsy();
      expect(indexer.startTime).toBeNull();
      expect(indexer.lastActivity).toBeDefined();
    });
  });

  describe('getters', () => {
    describe('isRunning', () => {
      it('should return false initially', () => {
        expect(indexer.isRunning).toBeFalsy();
      });

      it('should return true after start is called', async () => {
        mockNosanaClient.jobs.all.mockResolvedValue([]);
        mockNosanaClient.jobs.markets.mockResolvedValue([]);

        await indexer.start();

        expect(indexer.isRunning).toBeTruthy();
      });

      it('should return false after stop is called', async () => {
        mockNosanaClient.jobs.all.mockResolvedValue([]);
        mockNosanaClient.jobs.markets.mockResolvedValue([]);

        await indexer.start();
        indexer.stop();

        expect(indexer.isRunning).toBeFalsy();
      });
    });

    describe('startTime', () => {
      it('should return null initially', () => {
        expect(indexer.startTime).toBeNull();
      });

      it('should return Date after start is called', async () => {
        mockNosanaClient.jobs.all.mockResolvedValue([]);
        mockNosanaClient.jobs.markets.mockResolvedValue([]);

        await indexer.start();

        expect(indexer.startTime).toBeInstanceOf(Date);
      });

      it('should return null after stop is called', async () => {
        mockNosanaClient.jobs.all.mockResolvedValue([]);
        mockNosanaClient.jobs.markets.mockResolvedValue([]);

        await indexer.start();
        indexer.stop();

        expect(indexer.startTime).toBeNull();
      });
    });

    describe('lastActivity', () => {
      it('should return Date on construction', () => {
        expect(indexer.lastActivity).toBeInstanceOf(Date);
      });
    });

    describe('healthStatus', () => {
      it('should return object with all health properties', () => {
        const status = indexer.healthStatus;

        expect(status).toHaveProperty('isRunning');
        expect(status).toHaveProperty('lastActivity');
        expect(status).toHaveProperty('startTime');
        expect(status).toHaveProperty('uptime');
      });

      it('should return 0 uptime when not started', () => {
        const status = indexer.healthStatus;

        expect(status.uptime).toBe(0);
      });

      it('should calculate uptime correctly when running', async () => {
        mockNosanaClient.jobs.all.mockResolvedValue([]);
        mockNosanaClient.jobs.markets.mockResolvedValue([]);
        await indexer.start();
        // Wait a small amount of time to ensure uptime > 0
        await new Promise((resolve) => setTimeout(resolve, 10));

        const status = indexer.healthStatus;

        expect(status.uptime).toBeGreaterThan(0);
      });
    });
  });

  describe('start', () => {
    beforeEach(() => {
      mockNosanaClient.jobs.all.mockResolvedValue([]);
      mockNosanaClient.jobs.markets.mockResolvedValue([]);
    });

    it('should set isRunning to true', async () => {
      await indexer.start();

      expect(indexer.isRunning).toBeTruthy();
    });

    it('should set startTime to current date', async () => {
      await indexer.start();

      expect(indexer.startTime).toBeInstanceOf(Date);
    });

    it('should call jobsGPA', async () => {
      await indexer.start();

      expect(mockNosanaClient.jobs.all).toHaveBeenCalledWith(undefined, true);
    });

    it('should call marketsGPA', async () => {
      await indexer.start();

      expect(mockNosanaClient.jobs.markets).toHaveBeenCalled();
    });

    it('should call nosanaClient.jobs.monitorDetailed and use returned stream and stop', async () => {
      await indexer.start();

      expect(mockNosanaClient.jobs.monitorDetailed).toHaveBeenCalledWith();
    });

    it('should handle jobsGPA failure gracefully', async () => {
      mockNosanaClient.jobs.all.mockRejectedValue(new Error('GPA failed'));

      await expect(indexer.start()).resolves.not.toThrow();
    });

    it('should handle marketsGPA failure gracefully', async () => {
      mockNosanaClient.jobs.markets.mockRejectedValue(
        new Error('Markets GPA failed')
      );

      await expect(indexer.start()).resolves.not.toThrow();
    });
  });

  describe('stop', () => {
    it('should set isRunning to false', () => {
      indexer.stop();

      expect(indexer.isRunning).toBeFalsy();
    });

    it('should set startTime to null', () => {
      indexer.stop();

      expect(indexer.startTime).toBeNull();
    });

    it('should be idempotent', () => {
      indexer.stop();
      indexer.stop();

      expect(indexer.isRunning).toBeFalsy();
    });

    it('should work when called before start', () => {
      expect(() => indexer.stop()).not.toThrow();
    });
  });

  describe('handleRunUpdate', () => {
    const mockRun = createTestNosanaRun();

    it('should fetch job from run account', async () => {
      const mockJob = createTestNosanaJob();
      mockNosanaClient.jobs.get.mockResolvedValue(mockJob);
      mockJobAccountsRepo.findByAddress.mockResolvedValue(null);
      mockJobAccountsRepo.upsert.mockResolvedValue(createTestJobAccount());

      await indexer.handleRunUpdate(mockRun as any);

      expect(mockNosanaClient.jobs.get).toHaveBeenCalledWith(
        mockRun.job,
        false
      );
    });

    it('should merge run data into job', async () => {
      const mockJob = createTestNosanaJob({
        node: 'OldNodeAddress',
      });
      mockNosanaClient.jobs.get.mockResolvedValue(mockJob);
      mockJobAccountsRepo.findByAddress.mockResolvedValue(null);
      const updatedJobAccount = createTestJobAccount();
      mockJobAccountsRepo.upsert.mockResolvedValue(updatedJobAccount);

      const result = await indexer.handleRunUpdate(mockRun as any);

      expect(mockJobAccountsRepo.upsert).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.node).toBe(testNodeAddress);
    });

    it('should return null when job not found', async () => {
      mockNosanaClient.jobs.get.mockResolvedValue(null);

      const result = await indexer.handleRunUpdate(mockRun as any);

      expect(result).toBeNull();
    });

    it('should return null when job fetch fails', async () => {
      mockNosanaClient.jobs.get.mockResolvedValue(null);

      const result = await indexer.handleRunUpdate(mockRun as any);

      expect(result).toBeNull();
    });

    it('should handle run with zero time', async () => {
      const runWithZeroTime = createTestNosanaRun({
        time: indexerBoundaryValues.zeroPriceInLamports,
      });
      const mockJob = createTestNosanaJob();
      mockNosanaClient.jobs.get.mockResolvedValue(mockJob);
      mockJobAccountsRepo.findByAddress.mockResolvedValue(null);
      mockJobAccountsRepo.upsert.mockResolvedValue(createTestJobAccount());

      await indexer.handleRunUpdate(runWithZeroTime as any);

      expect(mockJobAccountsRepo.upsert).toHaveBeenCalled();
    });
  });

  describe('handleMarketUpdate', () => {
    const mockMarket = createTestNosanaMarket({
      address: createMockAddress(testMarketAddress),
      queueType: marketQueueNodeType,
      queue: [],
    });

    it('should query database for queued jobs in market', async () => {
      await indexer.handleMarketUpdate(mockMarket as any);

      expect(mockJobAccountsRepo.findQueuedByMarket).toHaveBeenCalledWith(
        testMarketAddress
      );
    });

    it('should handle NODE_QUEUE market type by removing all queued jobs', async () => {
      const nodeQueueMarket = createTestNosanaMarket({
        queueType: marketQueueNodeType,
        queue: [],
      });
      mockJobAccountsRepo.findQueuedByMarket.mockResolvedValue([
        createTestJobAccount({ address: job1Address }),
        createTestJobAccount({ address: job2Address }),
      ]);
      vi.mocked(checkJobExists).mockResolvedValue(false);

      await indexer.handleMarketUpdate(nodeQueueMarket as any);

      expect(mockJobAccountsRepo.delete).toHaveBeenCalledTimes(2);
    });

    it('should handle empty queue by removing all queued jobs', async () => {
      const emptyQueueMarket = createTestNosanaMarket({
        queueType: marketQueueNodeType,
        queue: [],
      });
      mockJobAccountsRepo.findQueuedByMarket.mockResolvedValue([
        createTestJobAccount({ address: job1Address }),
      ]);
      vi.mocked(checkJobExists).mockResolvedValue(false);

      await indexer.handleMarketUpdate(emptyQueueMarket as any);

      expect(mockJobAccountsRepo.delete).toHaveBeenCalled();
    });

    it('should not delete jobs still in queue', async () => {
      const marketWithQueue = createTestNosanaMarket({
        queueType: marketQueueJobType,
        queue: [createMockAddress(job1Address)],
      });
      mockJobAccountsRepo.findQueuedByMarket.mockResolvedValue([
        createTestJobAccount({ address: job1Address }),
      ]);
      // Job is still on-chain, so it shouldn't be deleted
      vi.mocked(checkJobExists).mockResolvedValue(true);

      await indexer.handleMarketUpdate(marketWithQueue as any);

      expect(mockJobAccountsRepo.delete).not.toHaveBeenCalled();
    });

    it('should handle market with no queued jobs in DB', async () => {
      mockJobAccountsRepo.findQueuedByMarket.mockResolvedValue([]);

      await indexer.handleMarketUpdate(mockMarket as any);

      expect(vi.mocked(checkJobExists)).not.toHaveBeenCalled();
      expect(mockJobAccountsRepo.delete).not.toHaveBeenCalled();
    });

    it('should handle checkJobExists returning false', async () => {
      mockJobAccountsRepo.findQueuedByMarket.mockResolvedValue([
        createTestJobAccount({ address: job1Address }),
      ]);
      vi.mocked(checkJobExists).mockResolvedValue(false);

      await indexer.handleMarketUpdate(mockMarket as any);

      expect(mockJobAccountsRepo.delete).toHaveBeenCalledWith(job1Address);
    });

    it('should handle checkJobExists throwing error', async () => {
      mockJobAccountsRepo.findQueuedByMarket.mockResolvedValue([
        createTestJobAccount({ address: job1Address }),
      ]);
      const mockCheckJobExists = vi.mocked(checkJobExists);
      mockCheckJobExists.mockRejectedValue(new Error(rpcErrorMessage));

      await expect(
        indexer.handleMarketUpdate(mockMarket as any)
      ).resolves.not.toThrow();
      expect(vi.mocked(checkJobExists)).toHaveBeenCalled();
      expect(mockJobAccountsRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('handleJobUpdate', () => {
    const mockJob = createTestNosanaJob({
      state: jobRunningState,
    });

    it('should return null when job equals existing DB job', async () => {
      const dbJob = createTestJobAccount({
        state: jobRunningState,
        payer: testPayerAddress,
        project: testProjectAddress,
        timeStart: 0,
        timeEnd: 0,
        ipfsJob: testIpfsJobHash,
        ipfsResult: null,
      });
      mockJobAccountsRepo.findByAddress.mockResolvedValue(dbJob);

      const result = await (indexer as any).handleJobUpdate(mockJob as any);

      // Should return null when job data has not changed
      expect(result).toBeNull();
      // Should not perform any database operations when data is unchanged
      expect(mockJobAccountsRepo.upsert).not.toHaveBeenCalled();
      expect(mockJobAccountsRepo.update).not.toHaveBeenCalled();
    });

    it('should skip update when new state is lower than existing', async () => {
      const dbJob = createTestJobAccount({
        state: jobCompletedState,
        ipfsResult: null,
      });
      mockJobAccountsRepo.findByAddress.mockResolvedValue(dbJob);
      const queuedJob = createTestNosanaJob();

      const result = await (indexer as any).handleJobUpdate(queuedJob as any);

      expect(result).toBeNull();
      expect(mockJobAccountsRepo.upsert).not.toHaveBeenCalled();
    });

    it('should allow update when state is higher', async () => {
      const dbJob = createTestJobAccount({
        state: jobQueuedState,
      });
      mockJobAccountsRepo.findByAddress.mockResolvedValue(dbJob);
      mockJobAccountsRepo.update.mockResolvedValue(
        createTestJobAccount({ state: jobRunningState })
      );
      const runningJob = createTestNosanaJob({
        state: jobRunningState,
      });

      await (indexer as any).handleJobUpdate(runningJob as any);

      expect(mockJobAccountsRepo.update).toHaveBeenCalled();
    });

    it('should allow partial update for timeout extension', async () => {
      const dbJob = createTestJobAccount({
        ipfsResult: null,
      });
      mockJobAccountsRepo.findByAddress.mockResolvedValue(dbJob);
      mockJobAccountsRepo.update.mockResolvedValue(createTestJobAccount());

      const extendedJob = createTestNosanaJob({
        state: jobRunningState, // Same state
        timeout: indexerBoundaryValues.timeoutTwoHours, // Higher timeout
      });

      await (indexer as any).handleJobUpdate(extendedJob as any);

      expect(mockJobAccountsRepo.update).toHaveBeenCalled();
    });

    it('should call insertOrUpdateJob when no existing job found', async () => {
      mockJobAccountsRepo.findByAddress.mockResolvedValue(null);
      mockJobAccountsRepo.upsert.mockResolvedValue(createTestJobAccount());

      await (indexer as any).handleJobUpdate(mockJob as any);

      expect(mockJobAccountsRepo.upsert).toHaveBeenCalled();
    });

    it('should call updateJob when existing job found', async () => {
      const dbJob = createTestJobAccount({
        state: jobQueuedState,
      });
      mockJobAccountsRepo.findByAddress.mockResolvedValue(dbJob);
      mockJobAccountsRepo.update.mockResolvedValue(
        createTestJobAccount({ state: jobQueuedState })
      );

      await (indexer as any).handleJobUpdate(mockJob as any);

      expect(mockJobAccountsRepo.update).toHaveBeenCalled();
    });
  });

  describe('updateDailyTables', () => {
    const timeStart = 1000;
    const completedJob = createTestJobAccount({
      state: jobCompletedState,
      timeStart: timeStart,
      timeEnd: secondsInAnHour + timeStart, // 1 hour duration
      timeout: secondsInTwoHours,
      usdRewardPerHour: 0.5,
    });

    it('should only process completed jobs', async () => {
      const queuedJob = createTestJobAccount({ state: 0 });

      await (indexer as any).updateDailyTables(queuedJob);

      expect(
        mockDailyEarningsRepo.upsertWithRecalculation
      ).not.toHaveBeenCalled();
    });

    it('should calculate correct date in UTC', async () => {
      await (indexer as any).updateDailyTables(completedJob);

      const expectedDate = new Date((completedJob as any).timeEnd * 1000)
        .toISOString()
        .split('T')[0];

      expect(
        mockDailyEarningsRepo.upsertWithRecalculation
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          date: expectedDate,
        })
      );
    });

    it('should calculate duration using minimum of actual and timeout', async () => {
      const jobExceedingTimeout = createTestJobAccount({
        state: jobCompletedState,
        timeStart: 1000,
        timeEnd: 10000, // Long duration, longer than default timeout of 1h
        usdRewardPerHour: 1.0,
      });

      await (indexer as any).updateDailyTables(jobExceedingTimeout);

      expect(
        mockDailyEarningsRepo.upsertWithRecalculation
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          // Duration should be capped at timeout (3600 seconds = 1 hour)
          totalEarnedUsd: 1.0, // 1 hour * 1.0 USD/hour,
        })
      );
    });

    it('should insert or update daily_earnings', async () => {
      await (indexer as any).updateDailyTables(completedJob);

      expect(
        mockDailyEarningsRepo.upsertWithRecalculation
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          node: completedJob.node,
          market: completedJob.market,
        })
      );
    });

    it('should insert or update daily_job_spend when usdRewardPerHour exists', async () => {
      await (indexer as any).updateDailyTables(completedJob);

      expect(
        mockDailyJobSpendRepo.upsertWithRecalculation
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          project: completedJob.project,
          market: completedJob.market,
        })
      );
    });

    it('should call daily_job_spend update even when usdRewardPerHour is null (uses market rate fallback)', async () => {
      const jobWithoutUsd = createTestJobAccount({
        state: jobCompletedState,
        timeStart: 1000,
        timeEnd: 2000,
        usdRewardPerHour: null,
      });

      await (indexer as any).updateDailyTables(jobWithoutUsd);

      expect(
        mockDailyJobSpendRepo.upsertWithRecalculation
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          project: jobWithoutUsd.project,
          market: jobWithoutUsd.market,
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDailyEarningsRepo.upsertWithRecalculation.mockRejectedValue(
        new Error(dbErrorMessage)
      );

      await expect(
        (indexer as any).updateDailyTables(completedJob)
      ).resolves.not.toThrow();
    });

    it('should handle jobs with zero duration', async () => {
      const timeStart = 1000;
      const zeroDurationJob = createTestJobAccount({
        state: jobCompletedState,
        timeStart: timeStart,
        timeEnd: timeStart,
        usdRewardPerHour: 1.0,
      });

      await (indexer as any).updateDailyTables(zeroDurationJob);

      expect(mockDailyEarningsRepo.upsertWithRecalculation).toHaveBeenCalled();
    });
  });

  describe('jobsGPA', () => {
    it('should call nosanaClient.jobs.all with correct params', async () => {
      mockNosanaClient.jobs.all.mockResolvedValue([]);

      await indexer.jobsGPA();

      expect(mockNosanaClient.jobs.all).toHaveBeenCalledWith(undefined, true);
    });

    it('should iterate through all returned jobs', async () => {
      const mockJobs = [
        createTestNosanaJob({ address: createMockAddress(job1Address) }),
        createTestNosanaJob({ address: createMockAddress(job2Address) }),
      ];
      mockNosanaClient.jobs.all.mockResolvedValue(mockJobs);
      mockJobAccountsRepo.findByAddress.mockResolvedValue(null);
      mockJobAccountsRepo.upsert.mockResolvedValue(createTestJobAccount());

      await indexer.jobsGPA();

      expect(mockJobAccountsRepo.findByAddress).toHaveBeenCalledTimes(2);
    });

    it('should handle empty jobs array', async () => {
      mockNosanaClient.jobs.all.mockResolvedValue([]);
      vi.spyOn(indexer as any, 'handleJobUpdate');

      await expect(indexer.jobsGPA()).resolves.not.toThrow();
      expect((indexer as any).handleJobUpdate).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockNosanaClient.jobs.all.mockRejectedValue(new Error(rpcErrorMessage));

      await expect(indexer.jobsGPA()).resolves.not.toThrow();
    });

    it('should continue processing if individual job fails', async () => {
      const mockJobs = [
        createTestNosanaJob({ address: createMockAddress(job1Address) }),
        createTestNosanaJob({ address: createMockAddress(job2Address) }),
      ];
      mockNosanaClient.jobs.all.mockResolvedValue(mockJobs);
      mockJobAccountsRepo.findByAddress
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error(dbErrorMessage));
      mockJobAccountsRepo.upsert.mockResolvedValue(createTestJobAccount());
      vi.spyOn(indexer as any, 'handleJobUpdate');

      await expect(indexer.jobsGPA()).resolves.not.toThrow();
      expect((indexer as any).handleJobUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('marketsGPA', () => {
    it('should call nosanaClient.jobs.markets', async () => {
      mockNosanaClient.jobs.markets.mockResolvedValue([]);

      await indexer.marketsGPA();

      expect(mockNosanaClient.jobs.markets).toHaveBeenCalled();
    });

    it('should iterate through all markets', async () => {
      const mockMarkets = [
        createTestNosanaMarket({ address: createMockAddress(marketAddress1) }),
        createTestNosanaMarket({ address: createMockAddress(marketAddress2) }),
      ];
      mockNosanaClient.jobs.markets.mockResolvedValue(mockMarkets);
      mockJobAccountsRepo.findQueuedByMarket.mockResolvedValue([]);

      await indexer.marketsGPA();

      expect(mockJobAccountsRepo.findQueuedByMarket).toHaveBeenCalledTimes(2);
    });

    it('should handle empty markets array', async () => {
      mockNosanaClient.jobs.markets.mockResolvedValue([]);
      vi.spyOn(indexer, 'handleMarketUpdate');

      await expect(indexer.marketsGPA()).resolves.not.toThrow();
      expect(indexer.handleMarketUpdate).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockNosanaClient.jobs.markets.mockRejectedValue(
        new Error(rpcErrorMessage)
      );
      vi.spyOn(indexer, 'handleMarketUpdate');

      await expect(indexer.marketsGPA()).resolves.not.toThrow();
      expect(indexer.handleMarketUpdate).not.toHaveBeenCalled();
    });

    it('should continue if individual market processing fails', async () => {
      const mockMarkets = [
        createTestNosanaMarket({ address: createMockAddress(marketAddress1) }),
        createTestNosanaMarket({ address: createMockAddress(marketAddress2) }),
      ];
      mockNosanaClient.jobs.markets.mockResolvedValue(mockMarkets);
      mockJobAccountsRepo.findQueuedByMarket
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error(dbErrorMessage));
      vi.spyOn(indexer, 'handleMarketUpdate');

      await expect(indexer.marketsGPA()).resolves.not.toThrow();
      expect(indexer.handleMarketUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('processJobs', () => {
    it('should query jobs with correct filters', async () => {
      mockJobAccountsRepo.findJobsToProcess.mockResolvedValue([]);

      await indexer.processJobs();

      expect(mockJobAccountsRepo.findJobsToProcess).toHaveBeenCalledWith({
        limit: 500,
        minTimeEnd: 1727690400,
      });
    });

    it('should call processJob for each returned job', async () => {
      const jobsToProcess = [
        createTestJobAccount({
          address: job1Address,
          listedAt: null,
          ipfsJob: ipfsJobHash1,
        }),
        createTestJobAccount({
          address: job2Address,
          jobDefinition: null,
          ipfsJob: ipfsJobHash2,
        }),
      ];
      mockJobAccountsRepo.findJobsToProcess.mockResolvedValue(jobsToProcess);
      // Mock getSignaturesForAddress for Job1
      mockNosanaClient.solana.rpc.getSignaturesForAddress.mockReturnValue({
        send: vi.fn().mockResolvedValue([{ blockTime: 1000000 }]),
      } as any);
      // Mock IPFS retrieval for Job2
      mockNosanaClient.ipfs.retrieve.mockResolvedValue(
        testIpfsMetaTriggerGithub
      );

      await indexer.processJobs();

      expect(mockJobAccountsRepo.simpleUpdate).toHaveBeenCalled();
    });

    it('should handle no jobs to process', async () => {
      mockJobAccountsRepo.findJobsToProcess.mockResolvedValue([]);
      vi.spyOn(indexer as any, 'processJob');

      await expect(indexer.processJobs()).resolves.not.toThrow();
      expect((indexer as any).processJob).not.toHaveBeenCalled();
    });

    it('should continue processing if individual job fails', async () => {
      const jobsToProcess = [
        createTestJobAccount({ address: job1Address }),
        createTestJobAccount({ address: job2Address }),
      ];
      mockJobAccountsRepo.findJobsToProcess.mockResolvedValue(jobsToProcess);
      mockJobAccountsRepo.simpleUpdate
        .mockRejectedValueOnce(new Error('Update failed'))
        .mockResolvedValueOnce(undefined);
      vi.spyOn(indexer as any, 'processJob');

      await expect(indexer.processJobs()).resolves.not.toThrow();
      expect((indexer as any).processJob).toHaveBeenCalledTimes(2);
    });

    it('should handle query errors gracefully', async () => {
      mockJobAccountsRepo.findJobsToProcess.mockRejectedValue(
        new Error('Query failed')
      );
      vi.spyOn(indexer as any, 'processJob');

      await expect(indexer.processJobs()).resolves.not.toThrow();
      expect((indexer as any).processJob).not.toHaveBeenCalled();
    });
  });

  describe('processJob', () => {
    it('should fetch signatures when listedAt is null', async () => {
      const job = createTestJobAccount({
        listedAt: null,
      });
      mockNosanaClient.solana.rpc.getSignaturesForAddress.mockReturnValue({
        send: vi
          .fn()
          .mockResolvedValue([{ blockTime: 1000000 }, { blockTime: 1000100 }]),
      } as any);

      await (indexer as any).processJob(job);

      expect(
        mockNosanaClient.solana.rpc.getSignaturesForAddress
      ).toHaveBeenCalled();
    });

    it('should call getNosPrice when listedAt exists and usdRewardPerHour is null', async () => {
      const job = createTestJobAccount({
        listedAt: 1000000,
        usdRewardPerHour: null,
        price: 1000000, // 1 NOS/second in lamports
      });
      vi.mocked(getNosPrice).mockResolvedValue(0.5);

      await (indexer as any).processJob(job);

      expect(getNosPrice).toHaveBeenCalledWith(1000000);
    });

    it('should retrieve IPFS job definition when missing', async () => {
      const job = createTestJobAccount({
        jobDefinition: null,
        ipfsJob: testIpfsJobHash,
      });
      mockNosanaClient.ipfs.retrieve.mockResolvedValue(
        testIpfsMetaTriggerGithub
      );

      await (indexer as any).processJob(job);

      expect(mockNosanaClient.ipfs.retrieve).toHaveBeenCalledWith(
        testIpfsJobHash
      );
    });

    it('should retrieve IPFS job result for completed jobs after TG3', async () => {
      const job = createTestJobAccount({
        state: jobCompletedState,
        jobResult: null,
        ipfsResult: testIpfsResultHash,
        timeEnd: 1727690500, // After TG3 cutoff
      });
      mockNosanaClient.ipfs.retrieve.mockResolvedValue({
        status: ipfsSuccessStatus,
        opStates: [{ logs: ['log1'], output: 'output1' }],
      });

      await (indexer as any).processJob(job);

      expect(mockNosanaClient.ipfs.retrieve).toHaveBeenCalledWith(
        testIpfsResultHash
      );
    });

    it('should not retrieve result for jobs before TG3 cutoff', async () => {
      const job = createTestJobAccount({
        state: jobCompletedState,
        jobResult: null,
        ipfsResult: testIpfsResultHash,
        timeEnd: 1727690000, // Before TG3 cutoff
      });

      await (indexer as any).processJob(job);

      expect(mockNosanaClient.ipfs.retrieve).not.toHaveBeenCalled();
    });

    it('should handle IPFS retrieval failure gracefully', async () => {
      const job = createTestJobAccount({
        jobDefinition: null,
        ipfsJob: testIpfsJobHash,
      });
      mockNosanaClient.ipfs.retrieve.mockRejectedValue(new Error('IPFS error'));

      await expect((indexer as any).processJob(job)).resolves.not.toThrow();
    });

    it('should return true when update is successful', async () => {
      const job = createTestJobAccount({
        listedAt: null,
      });
      mockNosanaClient.solana.rpc.getSignaturesForAddress.mockReturnValue({
        send: vi.fn().mockResolvedValue([{ blockTime: 1000000 }]),
      } as any);
      mockJobAccountsRepo.simpleUpdate.mockResolvedValue(undefined);

      const result = await (indexer as any).processJob(job);

      expect(result).toBeTruthy();
    });

    it('should return false when no updates needed', async () => {
      const job = createTestJobAccount({
        listedAt: 1000000,
        usdRewardPerHour: 1.5,
        jobDefinition: testIpfsMetaTriggerGithub,
        jobResult: { status: ipfsSuccessStatus },
      });

      const result = await (indexer as any).processJob(job);

      expect(result).toBeFalsy();
    });

    it('should handle getNosPrice returning null', async () => {
      const job = createTestJobAccount({
        listedAt: 1000000,
        usdRewardPerHour: null,
      });
      vi.mocked(getNosPrice).mockResolvedValue(null);

      await expect((indexer as any).processJob(job)).resolves.not.toThrow();
    });
  });

  describe('insertOrUpdateJob', () => {
    it('should convert Job to InsertJobAccount', async () => {
      const job = createTestNosanaJob();
      mockJobAccountsRepo.upsert.mockResolvedValue(createTestJobAccount());

      await indexer.insertOrUpdateJob(job as any);

      expect(mockJobAccountsRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'JobAddress123456789',
        })
      );
    });

    it('should return the upserted job', async () => {
      const job = createTestNosanaJob();
      const expectedResult = createTestJobAccount({
        address: 'JobAddress123456789',
      });
      mockJobAccountsRepo.upsert.mockResolvedValue(expectedResult);

      const result = await indexer.insertOrUpdateJob(job as any);

      expect(result).toEqual(expectedResult);
    });
  });

  describe('updateJob', () => {
    it('should handle partial updates', async () => {
      const partialJob = {
        address: createMockAddress(testJobAddress),
        state: 1,
      };
      mockJobAccountsRepo.update.mockResolvedValue(createTestJobAccount());

      await indexer.updateJob(partialJob as any);

      expect(mockJobAccountsRepo.update).toHaveBeenCalledWith(
        testJobAddress,
        expect.objectContaining({
          state: 1,
        })
      );
    });

    it('should return updated job when successful', async () => {
      const job = {
        address: createMockAddress(testJobAddress),
        state: jobRunningState,
      };
      const updatedJob = createTestJobAccount({
        address: testJobAddress,
        state: jobRunningState,
      });
      mockJobAccountsRepo.update.mockResolvedValue(updatedJob);

      const result = await indexer.updateJob(job as any);

      expect(result).toEqual(updatedJob);
    });

    it('should return null when update conditions not met', async () => {
      const job = {
        address: createMockAddress(testJobAddress),
        state: jobQueuedState,
      };
      mockJobAccountsRepo.update.mockResolvedValue(null);

      const result = await indexer.updateJob(job as any);

      expect(result).toBeNull();
    });
  });
});
