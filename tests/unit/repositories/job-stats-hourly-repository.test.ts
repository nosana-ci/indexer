import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockClientQuery } = vi.hoisted(() => ({
  mockClientQuery:
    vi.fn<(query: { text: string } | string, params?: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../../../src/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../../../src/db/schema");
  const db = drizzle({ client: { query: mockClientQuery } as never, schema });
  return { getDb: () => db };
});

import JobStatsHourlyRepository from "../../../src/repositories/job-stats-hourly.repository";

// The SQL text and params of the nth client query.
function call(index: number) {
  const [query, params] = mockClientQuery.mock.calls[index];
  const text = typeof query === "string" ? query : query.text;
  return { sql: text.replace(/\s+/g, " "), params: params ?? [] };
}

const NOW = new Date("2026-10-21T08:25:00.000Z");
const HOUR_48_AGO = Math.floor(NOW.getTime() / 1000 / 3600) * 3600 - 48 * 3600;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("JobStatsHourlyRepository.refresh", () => {
  it("recomputes the hours from 48 hours ago once the table is built", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [[NOW.toISOString()]] }) // built
      .mockResolvedValueOnce({ rows: [], rowCount: 49 }); // upsert

    const written = await new JobStatsHourlyRepository().refresh(48);

    expect(written).toBe(49);
    expect(call(0).sql).toContain('from "job_stats_hourly" limit $1');
    const write = call(1);
    expect(write.sql).toContain('insert into "job_stats_hourly"');
    expect(write.sql).toContain('on conflict ("hour") do update');
    expect(write.sql).toContain('left join "compute" on "bucket_start" = series.slot');
    expect(write.params).toContain(HOUR_48_AGO);
    expect(write.params).toContain("hour");
  });

  it("starts from the first job's hour while the table is empty", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // not built
      .mockResolvedValueOnce({ rows: [[1_668_001_234]] }) // first job
      .mockResolvedValueOnce({ rows: [], rowCount: 9592 });

    const written = await new JobStatsHourlyRepository().refresh(48);

    expect(written).toBe(9592);
    expect(call(1).sql).toContain('select min("time_start") from "jobs"');
    // The hour containing the first job: 1_668_001_234 rounds down to 1_667_998_800.
    expect(call(2).params).toContain(1_667_998_800);
  });

  it("rebuilds from the first job when the window is null, without checking the table", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [[1_668_001_234]] })
      .mockResolvedValueOnce({ rows: [], rowCount: 9592 });

    await new JobStatsHourlyRepository().refresh(null);

    expect(call(0).sql).toContain('select min("time_start") from "jobs"');
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when there are no jobs", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [[null]] });

    const written = await new JobStatsHourlyRepository().refresh(null);

    expect(written).toBe(0);
    expect(mockClientQuery).toHaveBeenCalledTimes(1);
  });
});

describe("JobStatsHourlyRepository.findBucketsSince", () => {
  it("groups the hourly rollup into the requested unit and returns numbers", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [["1790000000000", "12", "3600"]] });

    const result = await new JobStatsHourlyRepository().findBucketsSince(1_789_001_000, "week");

    expect(result).toEqual([{ bucket: 1_790_000_000_000, jobs: 12, seconds: 3600 }]);
    const query = call(0);
    expect(query.sql).toContain('from "job_stats_hourly"');
    expect(query.params[0]).toBe("week");
    // From the start of the hour containing `sinceUnix`.
    expect(query.params).toContain(
      new Date(Math.floor(1_789_001_000 / 3600) * 3600 * 1000).toISOString(),
    );
  });
});
