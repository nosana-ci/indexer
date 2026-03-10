import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTestNosanaJob,
  jobQueuedState,
  jobRunningState,
  jobCompletedState,
  marketQueueNodeType,
  secondsInTwoHours,
  testIpfsResultHash,
  testJobAddress,
  testMarketAddress,
  testPayerAddress,
  testProjectAddress,
  testPrice,
  secondsInAnHour,
  testTimeStart,
  testTimeEnd,
  testNodeAddress,
  testIpfsJobHash,
} from '../../utils/test-data.factory';
import { createMockNosanaClient } from '../../mocks/external-apis.mock';
import type { SelectJob } from '../../../src/db/tables/jobs';
import type { Job } from '@nosana/kit';

// Mock the @nosana/kit module to avoid ESM import issues
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
}));

import {
  jobsAreEqual,
  convertJobToInsertJob,
  checkJobExists,
  sleep,
} from '../../../src/indexer/utils';

describe('Indexer Utils', () => {
  describe('jobsAreEqual', () => {
    describe('exact matches', () => {
      it('should return true when all fields match exactly', () => {
        const dbJob = createTestNosanaJob() as SelectJob;
        const nosanaJob = createTestNosanaJob() as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(dbJob).toStrictEqual(nosanaJob);
        expect(result).toBe(true);
      });

      it('should return true when both jobs have null ipfsResult', () => {
        const dbJob = createTestNosanaJob({
          ipfsResult: null,
        }) as SelectJob;

        const nosanaJob = createTestNosanaJob({
          ipfsResult: null,
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(true);
      });
    });

    describe('single field differences', () => {
      it('should return false when state differs', () => {
        const dbJob = createTestNosanaJob({
          state: jobRunningState,
        }) as SelectJob;

        const nosanaJob = createTestNosanaJob() as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when timeStart differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          timeStart: BigInt(2000),
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when timeEnd differs', () => {
        const dbJob = createTestNosanaJob({
          timeEnd: 1000,
        }) as SelectJob;

        const nosanaJob = createTestNosanaJob({
          timeEnd: BigInt(2000),
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when timeout differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          timeout: BigInt(secondsInTwoHours),
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when price differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          price: BigInt(200),
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when node differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          node: 'OtherNodeAddress123',
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when market differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          market: 'OtherMarketAddress123',
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when payer differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          payer: 'OtherPayerAddress123',
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when project differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          project: 'OtherProjectAddress123',
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when ipfsJob differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          ipfsJob: 'QmOtherJobHash',
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });

      it('should return false when ipfsResult differs', () => {
        const dbJob = createTestNosanaJob() as SelectJob;

        const nosanaJob = createTestNosanaJob({
          ipfsResult: 'QmOtherResultHash',
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(false);
      });
    });

    describe('boundary value scenarios', () => {
      it('should handle zero values correctly', () => {
        const dbJob = createTestNosanaJob({
          timeStart: 0,
          timeEnd: 0,
          price: 0,
        }) as SelectJob;

        const nosanaJob = createTestNosanaJob({
          timeStart: 0,
          timeEnd: 0,
          price: 0,
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(true);
      });

      it('should handle very large number values correctly', () => {
        const dbJob = createTestNosanaJob({
          price: Number.MAX_SAFE_INTEGER,
        }) as SelectJob;

        const nosanaJob = createTestNosanaJob({
          price: Number.MAX_SAFE_INTEGER,
        }) as Job;

        const result = jobsAreEqual(dbJob, nosanaJob);

        expect(result).toBe(true);
      });
    });
  });

  describe('convertJobToInsertJob', () => {
    describe('full Job object conversion', () => {
      it('should convert complete Job object to InsertJobAccount', () => {
        const job = createTestNosanaJob({
          state: jobRunningState,
          ipfsResult: testIpfsResultHash,
        }) as Job;

        const result = convertJobToInsertJob(job);

        expect(result).toEqual({
          address: testJobAddress,
          state: jobRunningState,
          market: testMarketAddress,
          payer: testPayerAddress,
          project: testProjectAddress,
          node: testNodeAddress,
          price: testPrice,
          timeout: secondsInAnHour,
          timeStart: testTimeStart,
          timeEnd: testTimeEnd,
          ipfsJob: testIpfsJobHash,
          ipfsResult: testIpfsResultHash,
        });
      });

      it('should convert address objects to strings', () => {
        const job = createTestNosanaJob() as Job;

        const result = convertJobToInsertJob(job);

        expect(result.address).toBe(testJobAddress);
        expect(typeof result.address).toBe('string');
      });

      it('should convert BigInt values to numbers', () => {
        const job = createTestNosanaJob({
          price: BigInt(testPrice),
          timeout: BigInt(secondsInTwoHours),
          timeStart: BigInt(testTimeStart),
          timeEnd: BigInt(testTimeEnd),
        }) as Job;

        const result = convertJobToInsertJob(job);

        expect(result.price).toBe(testPrice);
        expect(result.timeout).toBe(secondsInTwoHours);
        expect(result.timeStart).toBe(testTimeStart);
        expect(result.timeEnd).toBe(testTimeEnd);
      });
    });

    describe('partial Job object conversion', () => {
      it('should convert partial Job with only address and state', () => {
        const partialJob: Partial<Job> & { address: Job['address'] } = {
          address: testJobAddress as Job['address'],
          state: jobCompletedState,
        };

        const result = convertJobToInsertJob(partialJob);

        expect(result).toEqual({
          address: testJobAddress,
          state: jobCompletedState,
        });
      });

      it('should only include defined fields in result', () => {
        const partialJob: Partial<Job> & { address: Job['address'] } = {
          address: testJobAddress as Job['address'],
          timeout: BigInt(secondsInAnHour),
          ipfsResult: testIpfsResultHash,
        };

        const result = convertJobToInsertJob(partialJob);

        expect(result).toEqual({
          address: testJobAddress,
          timeout: secondsInAnHour,
          ipfsResult: testIpfsResultHash,
        });
        expect(result).not.toHaveProperty('state');
        expect(result).not.toHaveProperty('price');
      });

      it('should handle Job with only address field', () => {
        const minimalJob: Partial<Job> & { address: Job['address'] } = {
          address: testJobAddress as Job['address'],
        };

        const result = convertJobToInsertJob(minimalJob);

        expect(result).toEqual({
          address: testJobAddress,
        });
      });
    });

    describe('optional field handling', () => {
      it('should handle null ipfsJob', () => {
        const job = createTestNosanaJob({
          ipfsJob: null,
        }) as Job;

        const result = convertJobToInsertJob(job);

        expect(result.ipfsJob).toBeNull();
      });

      it('should not include undefined fields', () => {
        const partialJob: Partial<Job> & { address: Job['address'] } = {
          address: testJobAddress as Job['address'],
          state: jobRunningState,
        };

        const result = convertJobToInsertJob(partialJob);

        expect(Object.keys(result)).toEqual(['address', 'state']);
      });

      it('should include ipfsResult when defined', () => {
        const job = createTestNosanaJob({
          ipfsResult: testIpfsResultHash,
        }) as Job;

        const result = convertJobToInsertJob(job);

        expect(result.ipfsResult).toBe(testIpfsResultHash);
      });
    });

    describe('boundary value conversion', () => {
      it('should handle zero BigInt values', () => {
        const zero = 0;
        const zeroBigInt = BigInt(zero);
        const job = createTestNosanaJob({
          price: zeroBigInt,
          timeout: zeroBigInt,
          timeStart: zeroBigInt,
          timeEnd: zeroBigInt,
        }) as Job;

        const result = convertJobToInsertJob(job);

        expect(result.price).toBe(zero);
        expect(result.timeout).toBe(zero);
        expect(result.timeStart).toBe(zero);
        expect(result.timeEnd).toBe(zero);
      });

      it('should handle very large BigInt values', () => {
        const maxSafeInt = Number.MAX_SAFE_INTEGER;
        const largeValue = BigInt(maxSafeInt);
        const job = createTestNosanaJob({
          price: largeValue,
        }) as Job;

        const result = convertJobToInsertJob(job);

        expect(result.price).toBe(maxSafeInt);
      });

      it('should handle empty string values', () => {
        const emptyString = '';
        const job = createTestNosanaJob({
          ipfsJob: emptyString,
          node: emptyString,
        }) as Job;

        const result = convertJobToInsertJob(job);

        expect(result.ipfsJob).toBe(emptyString);
        expect(result.node).toBe(emptyString);
      });
    });
  });

  describe('checkJobExists', () => {
    let mockNosanaClient: ReturnType<typeof createMockNosanaClient>;

    beforeEach(() => {
      mockNosanaClient = createMockNosanaClient();
    });

    describe('job exists scenarios', () => {
      it('should return true when job exists on-chain', async () => {
        const mockJob = createTestNosanaJob();
        mockNosanaClient.jobs.get.mockResolvedValue(mockJob);

        const result = await checkJobExists(
          mockNosanaClient as any,
          testJobAddress
        );

        expect(result).toBe(true);
        expect(mockNosanaClient.jobs.get).toHaveBeenCalledWith(
          expect.objectContaining({
            toString: expect.any(Function),
          })
        );
      });

      it('should call jobs.get with correct address format', async () => {
        mockNosanaClient.jobs.get.mockResolvedValue(createTestNosanaJob());

        await checkJobExists(mockNosanaClient as any, testJobAddress);

        const callArg = mockNosanaClient.jobs.get.mock.calls[0][0];
        expect(callArg.toString()).toBe(testJobAddress);
      });
    });

    describe('job does not exist scenarios', () => {
      it('should return false when error message contains "Account does not exist or has no data"', async () => {
        const error = new Error('Account does not exist or has no data');
        mockNosanaClient.jobs.get.mockRejectedValue(error);

        const result = await checkJobExists(
          mockNosanaClient as any,
          testJobAddress
        );

        expect(result).toBe(false);
      });

      it('should return false when error message contains "Account not found at address"', async () => {
        const error = new Error(
          'Account not found at address ' + testJobAddress
        );
        mockNosanaClient.jobs.get.mockRejectedValue(error);

        const result = await checkJobExists(
          mockNosanaClient as any,
          testJobAddress
        );

        expect(result).toBe(false);
      });

      it('should handle error with partial message match for "Account does not exist"', async () => {
        const error = new Error(
          'Error: Account does not exist or has no data for this address'
        );
        mockNosanaClient.jobs.get.mockRejectedValue(error);

        const result = await checkJobExists(
          mockNosanaClient as any,
          testJobAddress
        );

        expect(result).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should rethrow non-account-not-found errors', async () => {
        const errorMessage = 'Network connection failed';
        const error = new Error(errorMessage);
        mockNosanaClient.jobs.get.mockRejectedValue(error);

        await expect(
          checkJobExists(mockNosanaClient as any, testJobAddress)
        ).rejects.toThrow(errorMessage);
      });

      it('should rethrow errors without message property', async () => {
        const error = { code: 'UNKNOWN_ERROR' };
        mockNosanaClient.jobs.get.mockRejectedValue(error);

        await expect(
          checkJobExists(mockNosanaClient as any, testJobAddress)
        ).rejects.toEqual(error);
      });

      it('should rethrow errors with non-string message', async () => {
        const error = { message: 123 };
        mockNosanaClient.jobs.get.mockRejectedValue(error);

        await expect(
          checkJobExists(mockNosanaClient as any, testJobAddress)
        ).rejects.toEqual(error);
      });

      it('should rethrow RPC timeout errors', async () => {
        const errorMessage = 'RPC request timeout';
        const error = new Error(errorMessage);
        mockNosanaClient.jobs.get.mockRejectedValue(error);

        await expect(
          checkJobExists(mockNosanaClient as any, testJobAddress)
        ).rejects.toThrow(errorMessage);
      });
    });
  });

  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      {
        name: 'pause execution for specified number of seconds',
        sleepSeconds: 2,
      },
      {
        name: 'handle zero seconds delay',
        sleepSeconds: 0,
      },
      {
        name: 'handle fractional seconds',
        sleepSeconds: 0.5,
      },
      {
        name: 'handle very small delays',
        sleepSeconds: 0.001,
      },
      {
        name: 'handle large delays',
        sleepSeconds: 60,
      },
    ])(`should $name`, async ({ sleepSeconds }) => {
      const sleepPromise = sleep(sleepSeconds);

      // Fast-forward
      vi.advanceTimersByTime(sleepSeconds * 1000);

      await expect(sleepPromise).resolves.toBeUndefined();
    });

    it('should not resolve before time elapses', async () => {
      const sleepPromise = sleep(5);
      let resolved = false;

      sleepPromise.then(() => {
        resolved = true;
      });

      // Advance by only 3 seconds
      vi.advanceTimersByTime(3000);
      await Promise.resolve(); // Flush microtasks

      expect(resolved).toBe(false);

      // Advance the remaining 2 seconds
      vi.advanceTimersByTime(2000);
      await sleepPromise;

      expect(resolved).toBe(true);
    });
  });
});
