import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDurationBucketsSince, mockCountStartsByBucketSince, mockFindBucketsSince } =
  vi.hoisted(() => ({
    mockGetDurationBucketsSince: vi.fn(),
    mockCountStartsByBucketSince: vi.fn(),
    mockFindBucketsSince: vi.fn(),
  }));

vi.mock("../../../src/repositories/jobs.repository", () => ({
  default: class {
    getDurationBucketsSince = mockGetDurationBucketsSince;
    countStartsByBucketSince = mockCountStartsByBucketSince;
  },
}));

vi.mock("../../../src/repositories/job-stats-hourly.repository", () => ({
  default: class {
    findBucketsSince = mockFindBucketsSince;
  },
}));

import { JobsService } from "../../../src/modules/jobs/service";

const ONE_YEAR = 365 * 24 * 3600;
const ONE_MONTH = (365 / 12) * 24 * 3600;
const THREE_MONTHS = (365 / 4) * 24 * 3600;
const FOUR_MONTHS = (365 / 3) * 24 * 3600;
const SEVEN_DAYS = 7 * 24 * 3600;
const ONE_DAY = 24 * 3600;
const SIX_DAYS = 6 * 24 * 3600;
const TWELVE_HOURS_PLUS = 13 * 3600;
const ONE_HOUR = 3600;

const bucket = (ms: number, jobs: number, seconds: number) => ({ bucket: ms, jobs, seconds });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("JobsService.getDurationTimestamps", () => {
  it("converts summed seconds into hours and totals them", async () => {
    mockFindBucketsSince.mockResolvedValueOnce([
      bucket(1_700_000_000_000, 3, 7200), // 2h
      bucket(1_699_000_000_000, 1, 1800), // 0.5h
    ]);

    const service = new JobsService();
    const result = await service.getDurationTimestamps(ONE_MONTH);

    expect(result.data).toEqual([
      { x: 1_700_000_000_000, y: 2 },
      { x: 1_699_000_000_000, y: 0.5 },
    ]);
    expect(result.total).toBe(2.5);
  });

  it("rounds hours to two decimals", async () => {
    mockFindBucketsSince.mockResolvedValueOnce([bucket(1_700_000_000_000, 1, 100)]); // 0.0277h

    const service = new JobsService();
    const result = await service.getDurationTimestamps(ONE_MONTH);

    expect(result.data).toEqual([{ x: 1_700_000_000_000, y: 0.03 }]);
    expect(result.total).toBe(0.03);
  });

  it("leaves out buckets without compute", async () => {
    mockFindBucketsSince.mockResolvedValueOnce([
      bucket(1_700_000_000_000, 2, 0),
      bucket(1_699_000_000_000, 1, 3600),
    ]);

    const service = new JobsService();
    const result = await service.getDurationTimestamps(ONE_MONTH);

    expect(result.data).toEqual([{ x: 1_699_000_000_000, y: 1 }]);
  });

  it("returns empty data and zero total when there are no rows", async () => {
    mockFindBucketsSince.mockResolvedValueOnce([]);

    const service = new JobsService();
    const result = await service.getDurationTimestamps(ONE_MONTH);

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("reads all time (period 0) from the rollup by month", async () => {
    mockFindBucketsSince.mockResolvedValueOnce([]);

    const service = new JobsService();
    await service.getDurationTimestamps(0);

    expect(mockFindBucketsSince).toHaveBeenCalledWith(0, "month");
    expect(mockGetDurationBucketsSince).not.toHaveBeenCalled();
  });

  it.each([
    [ONE_YEAR, "week"],
    [FOUR_MONTHS + 1, "week"],
    [SIX_DAYS, "day"],
    [TWELVE_HOURS_PLUS, "hour"],
  ])("reads period %s from the rollup by %s", async (period, expectedInterval) => {
    mockFindBucketsSince.mockResolvedValueOnce([]);

    const service = new JobsService();
    await service.getDurationTimestamps(period);

    const [sinceArg, intervalArg] = mockFindBucketsSince.mock.calls[0];
    expect(intervalArg).toBe(expectedInterval);
    expect(sinceArg).toBeGreaterThan(0);
    expect(mockGetDurationBucketsSince).not.toHaveBeenCalled();
  });

  it("aggregates minute buckets live for periods up to 12 hours", async () => {
    mockGetDurationBucketsSince.mockResolvedValueOnce([{ bucket: 1_700_000_000_000, seconds: 60 }]);

    const service = new JobsService();
    const result = await service.getDurationTimestamps(ONE_HOUR);

    expect(mockGetDurationBucketsSince).toHaveBeenCalledWith(expect.any(Number), "minute");
    expect(mockFindBucketsSince).not.toHaveBeenCalled();
    expect(result.data).toEqual([{ x: 1_700_000_000_000, y: 0.02 }]);
  });

  it("reuses cached duration data within the configured TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockFindBucketsSince.mockResolvedValue([bucket(1_700_000_000_000, 1, 3600)]);

    const service = new JobsService();
    const first = await service.getDurationTimestamps(ONE_MONTH);

    vi.setSystemTime(new Date("2026-05-30T00:02:59.000Z"));
    const second = await service.getDurationTimestamps(ONE_MONTH);

    expect(mockFindBucketsSince).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("refreshes cached duration data after the TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockFindBucketsSince
      .mockResolvedValueOnce([bucket(1_700_000_000_000, 1, 3600)])
      .mockResolvedValueOnce([bucket(1_700_000_000_000, 2, 7200)]);

    const service = new JobsService();
    await service.getDurationTimestamps(THREE_MONTHS);

    vi.setSystemTime(new Date("2026-05-30T12:01:00.000Z"));
    const refreshed = await service.getDurationTimestamps(THREE_MONTHS);

    expect(mockFindBucketsSince).toHaveBeenCalledTimes(2);
    expect(refreshed.total).toBe(2);
  });
});

describe("JobsService.getTimestamps", () => {
  it("maps rollup buckets to job counts, leaves out empty ones, and totals them", async () => {
    mockFindBucketsSince.mockResolvedValueOnce([
      bucket(1_700_000_000_000, 5, 7200),
      bucket(1_699_000_000_000, 0, 0),
      bucket(1_698_000_000_000, 2, 0),
    ]);

    const service = new JobsService();
    const result = await service.getTimestamps(SEVEN_DAYS);

    expect(mockFindBucketsSince).toHaveBeenCalledWith(expect.any(Number), "day");
    expect(result.data).toEqual([
      { x: 1_700_000_000_000, y: 5 },
      { x: 1_698_000_000_000, y: 2 },
    ]);
    expect(result.total).toBe(7);
  });

  it("reads all time (period 0) from the rollup by month", async () => {
    mockFindBucketsSince.mockResolvedValueOnce([]);

    const service = new JobsService();
    await service.getTimestamps(0);

    expect(mockFindBucketsSince).toHaveBeenCalledWith(0, "month");
    expect(mockCountStartsByBucketSince).not.toHaveBeenCalled();
  });

  it("counts minute buckets live for periods up to 12 hours", async () => {
    mockCountStartsByBucketSince.mockResolvedValueOnce([{ bucket: 1_700_000_000_000, jobs: 3 }]);

    const service = new JobsService();
    const result = await service.getTimestamps(ONE_HOUR);

    expect(mockCountStartsByBucketSince).toHaveBeenCalledWith(expect.any(Number), "minute");
    expect(mockFindBucketsSince).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 3, data: [{ x: 1_700_000_000_000, y: 3 }] });
  });

  it("reuses cached job-count data within the configured TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockFindBucketsSince.mockResolvedValue([bucket(1_700_000_000_000, 1, 0)]);

    const service = new JobsService();
    const first = await service.getTimestamps(SEVEN_DAYS);

    vi.setSystemTime(new Date("2026-05-30T00:02:59.000Z"));
    const second = await service.getTimestamps(SEVEN_DAYS);

    expect(mockFindBucketsSince).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("refreshes job-count cache once the TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockFindBucketsSince
      .mockResolvedValueOnce([bucket(1_700_000_000_000, 1, 0)])
      .mockResolvedValueOnce([bucket(1_700_000_000_000, 2, 0)]);

    const service = new JobsService();
    await service.getTimestamps(ONE_DAY);

    vi.setSystemTime(new Date("2026-05-30T01:01:00.000Z"));
    const refreshed = await service.getTimestamps(ONE_DAY);

    expect(mockFindBucketsSince).toHaveBeenCalledTimes(2);
    expect(refreshed.total).toBe(2);
  });

  it("caches every period, all time included, for the same 3 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockFindBucketsSince.mockResolvedValue([bucket(1_700_000_000_000, 1, 0)]);

    const service = new JobsService();
    await service.getTimestamps(0);

    vi.setSystemTime(new Date("2026-05-30T00:02:59.000Z"));
    await service.getTimestamps(0);
    expect(mockFindBucketsSince).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-05-30T00:03:01.000Z"));
    await service.getTimestamps(0);
    expect(mockFindBucketsSince).toHaveBeenCalledTimes(2);
  });
});
