import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("../../../src/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../../../src/db/schema");

  const db = Object.assign(drizzle({ client: {} as never, schema }), {
    execute: mockExecute,
  });

  return {
    getDb: () => db,
  };
});

import JobsRepository from "../../../src/repositories/jobs.repository";

const dialect = new PgDialect();

function getCompiledQuery() {
  const [statement] = mockExecute.mock.calls[mockExecute.mock.calls.length - 1] as [SQL];
  return dialect.sqlToQuery(statement);
}

describe("JobsRepository.getDurationBucketsSince", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the rows from the database execution", async () => {
    const rows = [{ bucket: "1717200000000", seconds: "5400" }];
    mockExecute.mockResolvedValueOnce({ rows });

    const repository = new JobsRepository();
    const result = await repository.getDurationBucketsSince(3600, "hour");

    expect(result).toEqual(rows);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("builds SQL that includes running jobs and clips compute to the requested window", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const repository = new JobsRepository();
    await repository.getDurationBucketsSince(3600, "hour");

    const query = getCompiledQuery();

    expect(query.sql).toContain("WITH spans AS ((select");
    expect(query.sql).toContain("generate_series(");
    expect(query.sql).toContain("GREATEST(");
    expect(query.sql).toContain("LEAST(");
    expect(query.sql).toContain('GREATEST("time_start", $1) as "s"');
    expect(query.sql).toContain('"time_start" + "timeout"');
    expect(query.sql).toContain("CASE WHEN");
    expect(query.sql).toContain(
      'THEN LEAST("time_end", extract(epoch FROM now())::bigint) ELSE extract(epoch FROM now())::bigint END',
    );
    expect(query.sql).toContain('from "jobs" where');
    expect(query.sql).toContain('CASE WHEN "jobs"."state" = 2 THEN "jobs"."time_end" ELSE extract(epoch FROM now())::bigint END > $6');
    expect(query.params).toContain(3600);
    expect(query.params).toContain("hour");
    expect(query.params).toContain("1 hour");
    expect(query.params).toContain(1);
    expect(query.params).toContain(2);
    expect(query.params).toContain(0);
  });
});