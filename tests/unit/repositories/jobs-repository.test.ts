import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("../../../src/db/client", () => ({
  getDb: () => ({
    execute: mockExecute,
  }),
}));

import JobsRepository from "../../../src/repositories/jobs.repository";

const dialect = new PgDialect();

function getCompiledQuery() {
  const [statement] = mockExecute.mock.calls.at(-1) as [SQL];
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

    expect(query.sql).toContain("generate_series(");
    expect(query.sql).toContain("GREATEST(");
    expect(query.sql).toContain("LEAST(");
    expect(query.sql).toContain('GREATEST("jobs"."time_start", $1) AS s');
    expect(query.sql).toContain('"jobs"."time_start" + "jobs"."timeout"');
    expect(query.sql).toContain("CASE WHEN");
    expect(query.sql).toContain(
      'THEN LEAST("jobs"."time_end", extract(epoch FROM now())::bigint) ELSE extract(epoch FROM now())::bigint END',
    );
    expect(query.sql).toContain(
      'WHERE ("jobs"."state" = 1 OR ("jobs"."state" = 2 AND "jobs"."time_end" > 0))',
    );
    expect(query.sql).toContain(
      'AND (CASE WHEN "jobs"."state" = 2 THEN "jobs"."time_end" ELSE extract(epoch FROM now())::bigint END) > $2',
    );
    expect(query.params).toContain(3600);
    expect(query.params).toContain("hour");
    expect(query.params).toContain("1 hour");
    expect(query.params.filter((value) => value === 3600)).toHaveLength(2);
  });
});