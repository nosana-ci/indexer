/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  jobQueuedState,
  jobRunningState,
  jobCompletedState,
  marketQueueNodeType,
} from '../utils/test-data.factory';
import { createMockNosanaClient } from '../mocks/external-apis.mock';
import { Indexer } from '../../../src/indexer/indexer';

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
vi.mock('../../../src/repositories/jobs.repository', () => ({
  default: class MockJobsRepository {
    findByAddress = vi.fn();
    findQueuedByMarket = vi.fn();
    findJobsToProcess = vi.fn();
    upsert = vi.fn();
    update = vi.fn();
    simpleUpdate = vi.fn();
    delete = vi.fn();
  },
}));

vi.mock('../../../src/repositories/daily-earnings.repository', () => ({
  default: class MockDailyEarningsRepository {
    upsertWithRecalculation = vi.fn();
  },
}));

vi.mock('../../../src/repositories/daily-job-spend.repository', () => ({
  default: class MockDailyJobSpendRepository {
    upsertWithRecalculation = vi.fn();
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
    mockNosanaClient.jobs.all.mockResolvedValue([]);
    mockNosanaClient.jobs.markets.mockResolvedValue([]);

    indexer = new Indexer(mockNosanaClient as any);
  });

  describe('constructor', () => {
    it('should initialize with NosanaClient', () => {
      expect(indexer).toBeDefined();
      expect(indexer.isRunning).toBeFalsy();
    });

    it('should expose jobProcessor', () => {
      expect(indexer.jobProcessor).toBeDefined();
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
        await indexer.start();

        expect(indexer.isRunning).toBeTruthy();
      });

      it('should return false after stop is called', async () => {
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
        await indexer.start();

        expect(indexer.startTime).toBeInstanceOf(Date);
      });

      it('should return null after stop is called', async () => {
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
        await indexer.start();
        // Wait a small amount of time to ensure uptime > 0
        await new Promise((resolve) => setTimeout(resolve, 10));

        const status = indexer.healthStatus;

        expect(status.uptime).toBeGreaterThan(0);
      });
    });
  });

  describe('start', () => {
    it('should set isRunning to true', async () => {
      await indexer.start();

      expect(indexer.isRunning).toBeTruthy();
    });

    it('should set startTime to current date', async () => {
      await indexer.start();

      expect(indexer.startTime).toBeInstanceOf(Date);
    });

    it('should call jobsGPA via jobProcessor', async () => {
      await indexer.start();

      expect(mockNosanaClient.jobs.all).toHaveBeenCalledWith(undefined, true);
    });

    it('should call marketsGPA via jobProcessor', async () => {
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
});
