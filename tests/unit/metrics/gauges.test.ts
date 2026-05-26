import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRegistry } from "../../../src/metrics/registry";
import { registerStatsGauges } from "../../../src/metrics/gauges";

const FAKE_STATS = {
  date: new Date().toISOString(),
  nosStaked: "1234567",
  totalXNosStaked: "9876543",
  stakers: 420,
  price: 0.12,
  marketCap: 14800000,
  dailyVolume: 500000,
  totalSupply: 100000000,
  circulatingSupply: 80000000,
  dailyPriceChange: 3.5,
  usdValueStaked: null,
  fullyDilutedMarketCap: null,
};

function makeFakeStatsService() {
  return {
    getLatestStats: vi.fn().mockResolvedValue(FAKE_STATS),
  };
}

describe("registerStatsGauges", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers nosana_stats_nos_staked gauge that refreshes every 30s", async () => {
    const handle = createRegistry("api");
    const fakeStatsService = makeFakeStatsService();

    const cleanup = registerStatsGauges(handle, fakeStatsService as any);

    await vi.advanceTimersByTimeAsync(30_001);

    const output = await handle.registry.metrics();
    expect(output).toContain("nosana_stats_nos_staked");

    cleanup();
  });

  it("sets nosana_stats_stakers_count from stats service response", async () => {
    const handle = createRegistry("api");
    const fakeStatsService = makeFakeStatsService();

    const cleanup = registerStatsGauges(handle, fakeStatsService as any);

    await vi.advanceTimersByTimeAsync(30_001);

    const output = await handle.registry.metrics();
    expect(output).toContain("nosana_stats_stakers_count");
    expect(output).toMatch(/nosana_stats_stakers_count{[^}]*} 420/);

    cleanup();
  });

  it("does not throw when stats service returns null (missing data)", async () => {
    const handle = createRegistry("api");
    const fakeStatsService = {
      getLatestStats: vi.fn().mockResolvedValue(null),
    };

    const cleanup = registerStatsGauges(handle, fakeStatsService as any);

    await expect(vi.advanceTimersByTimeAsync(30_001)).resolves.not.toThrow();

    cleanup();
  });

  it("returns a cleanup function that stops the refresh interval", async () => {
    const handle = createRegistry("api");
    const fakeStatsService = makeFakeStatsService();

    const cleanup = registerStatsGauges(handle, fakeStatsService as any);

    await vi.advanceTimersByTimeAsync(30_001);
    const callCount = fakeStatsService.getLatestStats.mock.calls.length;

    cleanup();

    await vi.advanceTimersByTimeAsync(60_001);
    expect(fakeStatsService.getLatestStats.mock.calls.length).toBe(callCount);
  });
});
