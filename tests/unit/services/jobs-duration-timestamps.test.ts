import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDurationBucketsSince, mockFindTimeStartsSince } = vi.hoisted(() => ({
  mockGetDurationBucketsSince: vi.fn(),
  mockFindTimeStartsSince: vi.fn(),
}));

vi.mock("../../../src/repositories/jobs.repository", () => ({
  default: class {
    getDurationBucketsSince = mockGetDurationBucketsSince;
    findTimeStartsSince = mockFindTimeStartsSince;
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("JobsService.getDurationTimestamps", () => {
  it("converts summed seconds into hours and totals them", async () => {
    mockGetDurationBucketsSince.mockResolvedValueOnce([
      { bucket: 1_700_000_000_000, seconds: "7200" }, // 2h
      { bucket: 1_699_000_000_000, seconds: "1800" }, // 0.5h
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
    mockGetDurationBucketsSince.mockResolvedValueOnce([
      { bucket: 1_700_000_000_000, seconds: "100" }, // 0.02777..h -> 0.03
    ]);

    const service = new JobsService();
    const result = await service.getDurationTimestamps(ONE_MONTH);

    expect(result.data).toEqual([{ x: 1_700_000_000_000, y: 0.03 }]);
    expect(result.total).toBe(0.03);
  });

  it("returns empty data and zero total when there are no rows", async () => {
    mockGetDurationBucketsSince.mockResolvedValueOnce([]);

    const service = new JobsService();
    const result = await service.getDurationTimestamps(ONE_MONTH);

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("uses since=0 when period is 0 (all time)", async () => {
    mockGetDurationBucketsSince.mockResolvedValueOnce([]);

    const service = new JobsService();
    await service.getDurationTimestamps(0);

    expect(mockGetDurationBucketsSince).toHaveBeenCalledWith(0, "month");
  });

  it.each([
    [ONE_YEAR, "week"],
    [FOUR_MONTHS + 1, "week"],
    [SIX_DAYS, "day"],
    [TWELVE_HOURS_PLUS, "hour"],
    [ONE_HOUR, "minute"],
  ])("selects the correct bucket interval for period %s", async (period, expectedInterval) => {
    mockGetDurationBucketsSince.mockResolvedValueOnce([]);

    const service = new JobsService();
    await service.getDurationTimestamps(period);

    const [sinceArg, intervalArg] = mockGetDurationBucketsSince.mock.calls[0];
    expect(intervalArg).toBe(expectedInterval);
    expect(sinceArg).toBeGreaterThan(0);
  });

  it("reuses cached duration data within the configured TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockGetDurationBucketsSince.mockResolvedValue([{ bucket: 1_700_000_000_000, seconds: "3600" }]);

    const service = new JobsService();
    const first = await service.getDurationTimestamps(ONE_MONTH);

    vi.setSystemTime(new Date("2026-05-30T05:59:00.000Z"));
    const second = await service.getDurationTimestamps(ONE_MONTH);

    expect(mockGetDurationBucketsSince).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("refreshes cached duration data after the TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockGetDurationBucketsSince
      .mockResolvedValueOnce([{ bucket: 1_700_000_000_000, seconds: "3600" }])
      .mockResolvedValueOnce([{ bucket: 1_700_000_000_000, seconds: "7200" }]);

    const service = new JobsService();
    await service.getDurationTimestamps(THREE_MONTHS);

    vi.setSystemTime(new Date("2026-05-30T12:01:00.000Z"));
    const refreshed = await service.getDurationTimestamps(THREE_MONTHS);

    expect(mockGetDurationBucketsSince).toHaveBeenCalledTimes(2);
    expect(refreshed.total).toBe(2);
  });
});

describe("JobsService.getTimestamps cache", () => {
  it("reuses cached job-count data within the configured TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockFindTimeStartsSince.mockResolvedValue([{ timeStart: 1_700_000_000 }]);

    const service = new JobsService();
    const first = await service.getTimestamps(SEVEN_DAYS);

    vi.setSystemTime(new Date("2026-05-30T02:59:00.000Z"));
    const second = await service.getTimestamps(SEVEN_DAYS);

    expect(mockFindTimeStartsSince).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("refreshes job-count cache once the TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockFindTimeStartsSince
      .mockResolvedValueOnce([{ timeStart: 1_700_000_000 }])
      .mockResolvedValueOnce([{ timeStart: 1_700_000_000 }, { timeStart: 1_700_003_600 }]);

    const service = new JobsService();
    await service.getTimestamps(ONE_DAY);

    vi.setSystemTime(new Date("2026-05-30T01:01:00.000Z"));
    const refreshed = await service.getTimestamps(ONE_DAY);

    expect(mockFindTimeStartsSince).toHaveBeenCalledTimes(2);
    expect(refreshed.total).toBe(2);
  });

  it("keeps all-time cache warm for a full day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    mockFindTimeStartsSince.mockResolvedValue([{ timeStart: 1_700_000_000 }]);

    const service = new JobsService();
    await service.getTimestamps(0);

    vi.setSystemTime(new Date("2026-05-30T23:59:00.000Z"));
    await service.getTimestamps(0);

    expect(mockFindTimeStartsSince).toHaveBeenCalledTimes(1);
  });
});
