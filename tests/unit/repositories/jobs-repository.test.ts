import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockClientQuery } = vi.hoisted(() => ({
  mockClientQuery: vi.fn(),
}));

vi.mock("../../../src/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../../../src/db/schema");

  const db = drizzle({ client: { query: mockClientQuery } as never, schema });

  return {
    getDb: () => db,
  };
});

import JobsRepository from "../../../src/repositories/jobs.repository";

describe("JobsRepository.getDurationBucketsSince", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns buckets and seconds as numbers", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [["1717200000000", "5400"]] });

    const repository = new JobsRepository();
    const result = await repository.getDurationBucketsSince(3600, "hour");

    expect(result).toEqual([{ bucket: 1_717_200_000_000, seconds: 5400 }]);
  });

  it("builds SQL that includes running jobs and clips compute to the requested window", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const repository = new JobsRepository();
    await repository.getDurationBucketsSince(3600, "hour");

    const [{ text }, params] = mockClientQuery.mock.calls[0] as [{ text: string }, unknown[]];
    const sqlText = text.replace(/\s+/g, " ");

    expect(sqlText).toContain("generate_series(");
    // Clipped to the window, capped at now and the timeout.
    expect(sqlText).toContain('GREATEST("time_start", $');
    expect(sqlText).toContain(
      'CASE WHEN "state" = 2 THEN "time_end" ELSE extract(epoch FROM now())::bigint END',
    );
    expect(sqlText).toContain('"time_start" + "timeout"');
    // Running jobs, and completed jobs ending in the window: both index-served.
    expect(sqlText).toMatch(
      /"jobs"\."state" = \$\d+ or \("jobs"\."state" = \$\d+ and "jobs"\."time_end" > \$\d+\)/,
    );
    expect(sqlText).toContain('order by "bucket_start" desc');
    expect(params).toEqual(expect.arrayContaining([3600, "hour", "1 hour", 1, 2]));
  });
});
describe("JobsRepository.getRunningNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects distinct running nodes across all markets", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [["NodeA"], ["NodeB"]] });

    const repository = new JobsRepository();
    const result = await repository.getRunningNodes(1);

    expect(result).toEqual([{ node: "NodeA" }, { node: "NodeB" }]);
    const [{ text }, params] = mockClientQuery.mock.calls[0] as [{ text: string }, unknown[]];
    expect(text).toBe('select distinct "node" from "jobs" where "jobs"."state" = $1');
    expect(text).not.toContain('"market"');
    expect(params).toEqual([1]);
  });
});
