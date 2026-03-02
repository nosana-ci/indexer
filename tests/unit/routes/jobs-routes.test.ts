import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Elysia, t } from 'elysia';

const { mockJobsService } = vi.hoisted(() => {
  const mockJobsService = {
    getJobs: vi.fn(),
    getRunningJobs: vi.fn(),
    getRunningNodesForMarket: vi.fn(),
    getLongRunningJobs: vi.fn(),
    getStats: vi.fn(),
    getTimestamps: vi.fn(),
    getJobsCount: vi.fn(),
    getJobsByAddresses: vi.fn(),
    getByAddress: vi.fn(),
  };
  return { mockJobsService };
});

vi.mock('../../../src/modules/jobs/service', () => ({
  JobsService: class {
    getJobs = mockJobsService.getJobs;
    getRunningJobs = mockJobsService.getRunningJobs;
    getRunningNodesForMarket = mockJobsService.getRunningNodesForMarket;
    getLongRunningJobs = mockJobsService.getLongRunningJobs;
    getStats = mockJobsService.getStats;
    getTimestamps = mockJobsService.getTimestamps;
    getJobsCount = mockJobsService.getJobsCount;
    getJobsByAddresses = mockJobsService.getJobsByAddresses;
    getByAddress = mockJobsService.getByAddress;
  },
}));

vi.mock('../../../src/middleware/rate-limit', () => ({
  jobsRateLimit: () => new Elysia(),
  jobsHourlyRateLimit: () => new Elysia(),
  jobsDailyRateLimit: () => new Elysia(),
}));

import jobsRouter from '../../../src/modules/jobs/route';

const BASE_URL = 'http://localhost';
const DEFAULT_BATCH_LIMIT = 100;

const testMarketAddr = 'MarketAddr';
const testNodeAddr = 'NodeAddr';
const testProjectAddr = 'ProjAddr';
const testPayerAddr = 'PayerAddr';
const testJobAddr1 = 'addr1';
const testJobAddr2 = 'addr2';

const batchJobItem = {
  id: 1,
  address: testJobAddr1,
  ipfsJob: null,
  ipfsResult: null,
  market: 'M',
  node: 'N',
  payer: 'P',
  price: 100,
  project: 'Proj',
  state: 1,
  type: null,
  jobStatus: null,
  timeEnd: 2000,
  timeStart: 1000,
  timeout: 3600,
  usdRewardPerHour: null,
  listedAt: null,
};

const fullCountResult = {
  total: 150,
  byState: { QUEUED: 10, RUNNING: 20, COMPLETED: 100, STOPPED: 20 },
};

const emptyCountResult = (overrides: Partial<typeof fullCountResult['byState']> = {}) => ({
  total: Object.values({ ...{ QUEUED: 0, RUNNING: 0, COMPLETED: 0, STOPPED: 0 }, ...overrides }).reduce((a, b) => a + b, 0),
  byState: { QUEUED: 0, RUNNING: 0, COMPLETED: 0, STOPPED: 0, ...overrides },
});

function createApp() {
  return new Elysia()
    .onError(({ error, status, code }) => {
      if (code === 'VALIDATION') {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Validation failed';
        return status(400, { message });
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        'message' in error
      ) {
        const { status: errStatus, message } = error as {
          status: number;
          message: string;
        };
        return status(errStatus, { message });
      }
      return status(500, { message: 'Internal server error' });
    })
    .use(jobsRouter);
}

function postBatch(body: object) {
  return new Request(`${BASE_URL}/jobs/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Jobs Routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /jobs/count', () => {
    it('should return total and per-state counts', async () => {
      mockJobsService.getJobsCount.mockResolvedValue(fullCountResult);

      const res = await app.handle(new Request(`${BASE_URL}/jobs/count`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.total).toBe(fullCountResult.total);
      expect(body.byState.QUEUED).toBe(fullCountResult.byState.QUEUED);
      expect(body.byState.RUNNING).toBe(fullCountResult.byState.RUNNING);
      expect(body.byState.COMPLETED).toBe(fullCountResult.byState.COMPLETED);
      expect(body.byState.STOPPED).toBe(fullCountResult.byState.STOPPED);
    });

    it('should pass market filter to service', async () => {
      mockJobsService.getJobsCount.mockResolvedValue(emptyCountResult({ RUNNING: 5 }));

      await app.handle(
        new Request(`${BASE_URL}/jobs/count?market=${testMarketAddr}`)
      );

      expect(mockJobsService.getJobsCount).toHaveBeenCalledWith(
        expect.objectContaining({ market: testMarketAddr })
      );
    });

    it('should pass node filter to service', async () => {
      mockJobsService.getJobsCount.mockResolvedValue(emptyCountResult({ RUNNING: 2 }));

      await app.handle(
        new Request(`${BASE_URL}/jobs/count?node=${testNodeAddr}`)
      );

      expect(mockJobsService.getJobsCount).toHaveBeenCalledWith(
        expect.objectContaining({ node: testNodeAddr })
      );
    });

    it('should pass project filter to service', async () => {
      mockJobsService.getJobsCount.mockResolvedValue(emptyCountResult({ COMPLETED: 7 }));

      await app.handle(
        new Request(`${BASE_URL}/jobs/count?project=${testProjectAddr}`)
      );

      expect(mockJobsService.getJobsCount).toHaveBeenCalledWith(
        expect.objectContaining({ project: testProjectAddr })
      );
    });

    it('should pass payer filter to service', async () => {
      mockJobsService.getJobsCount.mockResolvedValue(emptyCountResult({ RUNNING: 1 }));

      await app.handle(
        new Request(`${BASE_URL}/jobs/count?payer=${testPayerAddr}`)
      );

      expect(mockJobsService.getJobsCount).toHaveBeenCalledWith(
        expect.objectContaining({ payer: testPayerAddr })
      );
    });

    it('should pass multiple filters to service', async () => {
      mockJobsService.getJobsCount.mockResolvedValue(emptyCountResult({ RUNNING: 1 }));

      await app.handle(
        new Request(
          `${BASE_URL}/jobs/count?market=M&node=N&project=P&payer=Y`
        )
      );

      expect(mockJobsService.getJobsCount).toHaveBeenCalledWith(
        expect.objectContaining({
          market: 'M',
          node: 'N',
          project: 'P',
          payer: 'Y',
        })
      );
    });
  });

  describe('POST /jobs/batch', () => {
    it('should return jobs for given addresses', async () => {
      const batchResult = [batchJobItem];
      mockJobsService.getJobsByAddresses.mockResolvedValue(batchResult);

      const res = await app.handle(
        postBatch({ addresses: [testJobAddr1] })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(batchResult.length);
      expect(body[0].address).toBe(testJobAddr1);
      expect(body[0]).not.toHaveProperty('jobDefinition');
      expect(body[0]).not.toHaveProperty('jobResult');
    });

    it('should default limit to 100', async () => {
      mockJobsService.getJobsByAddresses.mockResolvedValue([]);

      await app.handle(postBatch({ addresses: [testJobAddr1] }));

      expect(mockJobsService.getJobsByAddresses).toHaveBeenCalledWith(
        [testJobAddr1],
        DEFAULT_BATCH_LIMIT
      );
    });

    it('should use provided limit', async () => {
      const customLimit = 50;
      mockJobsService.getJobsByAddresses.mockResolvedValue([]);

      await app.handle(
        postBatch({ addresses: [testJobAddr1, testJobAddr2], limit: customLimit })
      );

      expect(mockJobsService.getJobsByAddresses).toHaveBeenCalledWith(
        [testJobAddr1, testJobAddr2],
        customLimit
      );
    });

    it('should return validation error when addresses is empty', async () => {
      const res = await app.handle(postBatch({ addresses: [] }));

      expect(res.status).toBe(400);
    });

    it('should return validation error when body is missing', async () => {
      const res = await app.handle(postBatch({}));

      expect(res.status).toBe(400);
    });
  });

  describe('GET /jobs/running-nodes', () => {
    it('should return 400 when market is missing', async () => {
      const res = await app.handle(
        new Request(`${BASE_URL}/jobs/running-nodes`)
      );

      expect(res.status).toBe(400);
      expect(mockJobsService.getRunningNodesForMarket).not.toHaveBeenCalled();
    });

    it('should return running nodes when market is provided', async () => {
      const expectedNodes = ['node1', 'node2'];
      mockJobsService.getRunningNodesForMarket.mockResolvedValue(expectedNodes);

      const res = await app.handle(
        new Request(`${BASE_URL}/jobs/running-nodes?market=${testMarketAddr}`)
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(expectedNodes);
    });
  });

  describe('GET /jobs with payer filter', () => {
    it('should pass payer filter to getJobs', async () => {
      mockJobsService.getJobs.mockResolvedValue({ jobs: [], totalJobs: 0 });

      await app.handle(
        new Request(`${BASE_URL}/jobs?payer=${testPayerAddr}`)
      );

      expect(mockJobsService.getJobs).toHaveBeenCalledWith(
        expect.objectContaining({ payer: testPayerAddr })
      );
    });
  });
});
