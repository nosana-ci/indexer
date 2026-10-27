import { NotFoundError } from "elysia";
import { JobState, MarketQueueType } from "@nosana/kit";
import MarketsRepository from "../../repositories/markets.repository";
import JobsRepository from "../../repositories/jobs.repository";
import type { SelectMarket } from "../../db/tables/markets";
import type { MarketResponse, QueuedNodeResponse } from "./model";

export class MarketsService {
  private readonly marketsRepo: MarketsRepository;
  private readonly jobsRepo: JobsRepository;

  constructor() {
    this.marketsRepo = new MarketsRepository();
    this.jobsRepo = new JobsRepository();
  }

  async getMarkets(): Promise<MarketResponse[]> {
    const [markets, running] = await Promise.all([
      this.marketsRepo.findAll(),
      this.jobsRepo.countRunningByMarket(),
    ]);
    const runningByMarket = new Map(running.map((r) => [r.market, Number(r.running)]));
    return markets.map((m) => this.toResponse(m, runningByMarket.get(m.address) ?? 0));
  }

  async getMarketByAddress(address: string): Promise<MarketResponse> {
    const market = await this.marketsRepo.findByAddress(address);
    if (!market) throw new NotFoundError("Market not found");
    const running = await this.jobsRepo.countRunningByMarket();
    const runningCount = running.find((r) => r.market === address)?.running ?? 0;
    return this.toResponse(market, Number(runningCount));
  }

  /** Every node waiting in a node-queue market, ordered by market then queue position. */
  async getQueuedNodes(): Promise<QueuedNodeResponse[]> {
    return this.marketsRepo.findQueuedNodes();
  }

  /** Distinct nodes currently running a job, across all markets. */
  async getRunningNodes(): Promise<string[]> {
    const rows = await this.jobsRepo.getRunningNodes(JobState.RUNNING);
    return rows.map((row) => row.node);
  }

  private toResponse(market: SelectMarket, running: number): MarketResponse {
    const isNodeQueue = market.queueType === MarketQueueType.NODE_QUEUE;
    return {
      address: market.address,
      queueType: market.queueType,
      nodesInQueue: isNodeQueue ? market.queueLength : 0,
      jobsInQueue: isNodeQueue ? 0 : market.queueLength,
      running,
      queue: market.queue,
      jobPrice: market.jobPrice,
      jobTimeout: market.jobTimeout,
      jobExpiration: market.jobExpiration,
      jobType: market.jobType,
      settingsAddress: market.settingsAddress ?? null,
      projectAccessKey: market.projectAccessKey ?? null,
      updatedAt: market.updatedAt,
    };
  }
}
