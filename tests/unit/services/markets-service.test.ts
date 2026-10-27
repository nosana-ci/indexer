import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMarketsRepo, mockJobsRepo } = vi.hoisted(() => ({
  mockMarketsRepo: {
    findAll: vi.fn(),
    findByAddress: vi.fn(),
    findQueuedNodes: vi.fn(),
  },
  mockJobsRepo: {
    countRunningByMarket: vi.fn(),
    getRunningNodes: vi.fn(),
  },
}));

vi.mock("../../../src/repositories/markets.repository", () => ({
  default: class {
    findAll = mockMarketsRepo.findAll;
    findByAddress = mockMarketsRepo.findByAddress;
    findQueuedNodes = mockMarketsRepo.findQueuedNodes;
  },
}));

vi.mock("../../../src/repositories/jobs.repository", () => ({
  default: class {
    countRunningByMarket = mockJobsRepo.countRunningByMarket;
    getRunningNodes = mockJobsRepo.getRunningNodes;
  },
}));

import { MarketsService } from "../../../src/modules/markets/service";

const marketRow = (overrides: Record<string, unknown> = {}) => ({
  address: "MarketA",
  authority: "Auth",
  queueType: 1,
  queue: ["NodeA", "NodeB"],
  queueLength: 2,
  jobPrice: 100,
  jobTimeout: 3600,
  jobExpiration: 0,
  jobType: 0,
  settingsAddress: null,
  projectAccessKey: null,
  updatedAt: 1_700_000_000,
  ...overrides,
});

describe("MarketsService", () => {
  let service: MarketsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MarketsService();
  });

  describe("getQueuedNodes", () => {
    it("returns the repository's flattened queue rows unchanged", async () => {
      const rows = [
        { marketAddress: "MarketA", nodeAddress: "NodeA", position: 0 },
        { marketAddress: "MarketB", nodeAddress: "NodeC", position: 0 },
      ];
      mockMarketsRepo.findQueuedNodes.mockResolvedValue(rows);

      expect(await service.getQueuedNodes()).toEqual(rows);
    });
  });

  describe("getRunningNodes", () => {
    it("queries the RUNNING state across all markets and returns node addresses", async () => {
      mockJobsRepo.getRunningNodes.mockResolvedValue([{ node: "NodeA" }, { node: "NodeB" }]);

      expect(await service.getRunningNodes()).toEqual(["NodeA", "NodeB"]);
      expect(mockJobsRepo.getRunningNodes).toHaveBeenCalledWith(1);
    });

    it("returns an empty array when no node is running", async () => {
      mockJobsRepo.getRunningNodes.mockResolvedValue([]);

      expect(await service.getRunningNodes()).toEqual([]);
    });
  });

  describe("getMarkets", () => {
    it("splits queue length by queue type and joins running counts", async () => {
      mockMarketsRepo.findAll.mockResolvedValue([
        marketRow(),
        marketRow({ address: "MarketB", queueType: 0, queue: ["Job1"], queueLength: 1 }),
      ]);
      mockJobsRepo.countRunningByMarket.mockResolvedValue([{ market: "MarketA", running: 3 }]);

      const [nodeQueue, jobQueue] = await service.getMarkets();

      expect(nodeQueue).toMatchObject({ nodesInQueue: 2, jobsInQueue: 0, running: 3 });
      expect(jobQueue).toMatchObject({ nodesInQueue: 0, jobsInQueue: 1, running: 0 });
      expect(nodeQueue).not.toHaveProperty("authority");
    });

    it("returns null settings columns for an open market", async () => {
      mockMarketsRepo.findAll.mockResolvedValue([marketRow()]);
      mockJobsRepo.countRunningByMarket.mockResolvedValue([]);

      const [market] = await service.getMarkets();

      expect(market).toMatchObject({ settingsAddress: null, projectAccessKey: null });
    });

    it("passes the settings account and access key of a restricted market through", async () => {
      mockMarketsRepo.findAll.mockResolvedValue([
        marketRow({ settingsAddress: "Settings1", projectAccessKey: "Collection1" }),
      ]);
      mockJobsRepo.countRunningByMarket.mockResolvedValue([]);

      const [market] = await service.getMarkets();

      expect(market).toMatchObject({ settingsAddress: "Settings1", projectAccessKey: "Collection1" });
      expect(market).not.toHaveProperty("settings");
    });
  });

  describe("getMarketByAddress", () => {
    it("throws NotFoundError for an unknown market", async () => {
      mockMarketsRepo.findByAddress.mockResolvedValue(undefined);

      await expect(service.getMarketByAddress("Nope")).rejects.toThrow("Market not found");
    });
  });
});
