import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Elysia, NotFoundError } from 'elysia';

const { mockMarketsService } = vi.hoisted(() => ({
  mockMarketsService: {
    getMarkets: vi.fn(),
    getMarketByAddress: vi.fn(),
    getQueuedNodes: vi.fn(),
    getRunningNodes: vi.fn(),
  },
}));

vi.mock('../../../src/modules/markets/service', () => ({
  MarketsService: class {
    getMarkets = mockMarketsService.getMarkets;
    getMarketByAddress = mockMarketsService.getMarketByAddress;
    getQueuedNodes = mockMarketsService.getQueuedNodes;
    getRunningNodes = mockMarketsService.getRunningNodes;
  },
}));

import marketsRouter from '../../../src/modules/markets/route';

const BASE_URL = 'http://localhost';
const marketAddr = 'Market11111111111111111111111111111111111111';

const marketResponse = {
  address: marketAddr,
  queueType: 1,
  nodesInQueue: 2,
  jobsInQueue: 0,
  running: 1,
  queue: ['NodeA', 'NodeB'],
  jobPrice: 100,
  jobTimeout: 3600,
  jobExpiration: 0,
  jobType: 0,
  settingsAddress: null,
  projectAccessKey: null,
  updatedAt: 1_700_000_000,
};

function createApp() {
  return new Elysia()
    .onError(({ error, status }) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        'message' in error
      ) {
        const { status: errStatus, message } = error as { status: number; message: string };
        return status(errStatus, { message });
      }
      return status(500, { message: 'Internal server error' });
    })
    .use(marketsRouter);
}

describe('Markets Routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /markets', () => {
    it('returns markets with queue and running counts', async () => {
      mockMarketsService.getMarkets.mockResolvedValue([marketResponse]);

      const res = await app.handle(new Request(`${BASE_URL}/markets`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        address: marketAddr,
        nodesInQueue: 2,
        jobsInQueue: 0,
        running: 1,
        queue: ['NodeA', 'NodeB'],
      });
    });

    it('returns the settings of a restricted market', async () => {
      const settings = { settingsAddress: 'Settings1', projectAccessKey: 'Collection1' };
      mockMarketsService.getMarkets.mockResolvedValue([{ ...marketResponse, ...settings }]);

      const res = await app.handle(new Request(`${BASE_URL}/markets`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body[0]).toMatchObject(settings);
    });

    it('returns an empty array when there are no markets', async () => {
      mockMarketsService.getMarkets.mockResolvedValue([]);

      const res = await app.handle(new Request(`${BASE_URL}/markets`));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe('GET /markets/:address', () => {
    it('returns a single market', async () => {
      mockMarketsService.getMarketByAddress.mockResolvedValue(marketResponse);

      const res = await app.handle(new Request(`${BASE_URL}/markets/${marketAddr}`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(mockMarketsService.getMarketByAddress).toHaveBeenCalledWith(marketAddr);
      expect(body.address).toBe(marketAddr);
    });

    it('returns 404 when the market is unknown', async () => {
      mockMarketsService.getMarketByAddress.mockRejectedValue(new NotFoundError('Market not found'));

      const res = await app.handle(new Request(`${BASE_URL}/markets/${marketAddr}`));

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: 'Market not found' });
    });
  });

  describe('GET /markets/queued-nodes', () => {
    it('returns queued nodes with market and position', async () => {
      const queued = [
        { marketAddress: 'MarketA', nodeAddress: 'NodeA', position: 0 },
        { marketAddress: 'MarketA', nodeAddress: 'NodeB', position: 1 },
        { marketAddress: 'MarketB', nodeAddress: 'NodeC', position: 0 },
      ];
      mockMarketsService.getQueuedNodes.mockResolvedValue(queued);

      const res = await app.handle(new Request(`${BASE_URL}/markets/queued-nodes`));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(queued);
    });

    it('is not shadowed by the /:address route', async () => {
      mockMarketsService.getQueuedNodes.mockResolvedValue([]);

      const res = await app.handle(new Request(`${BASE_URL}/markets/queued-nodes`));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
      expect(mockMarketsService.getMarketByAddress).not.toHaveBeenCalled();
    });
  });

  describe('GET /markets/running-nodes', () => {
    it('returns running node addresses across all markets', async () => {
      mockMarketsService.getRunningNodes.mockResolvedValue(['NodeA', 'NodeB']);

      const res = await app.handle(new Request(`${BASE_URL}/markets/running-nodes`));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(['NodeA', 'NodeB']);
      expect(mockMarketsService.getMarketByAddress).not.toHaveBeenCalled();
    });

    it('returns an empty array when no node is running', async () => {
      mockMarketsService.getRunningNodes.mockResolvedValue([]);

      const res = await app.handle(new Request(`${BASE_URL}/markets/running-nodes`));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });
});
