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

import MarketsRepository from "../../../src/repositories/markets.repository";

const dialect = new PgDialect();

function getCompiledQuery() {
  const [statement] = mockExecute.mock.calls[mockExecute.mock.calls.length - 1] as [SQL];
  return dialect.sqlToQuery(statement);
}

describe("MarketsRepository.findQueuedNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the flattened rows from the database execution", async () => {
    const rows = [
      { marketAddress: "MarketA", nodeAddress: "NodeA", position: 0 },
      { marketAddress: "MarketA", nodeAddress: "NodeB", position: 1 },
    ];
    mockExecute.mockResolvedValueOnce({ rows });

    const result = await new MarketsRepository().findQueuedNodes();

    expect(result).toEqual(rows);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when no node is queued", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    expect(await new MarketsRepository().findQueuedNodes()).toEqual([]);
  });

  it("flattens each queue in one SQL with a 0-based position, ordered by market then position", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await new MarketsRepository().findQueuedNodes();
    const query = getCompiledQuery();

    // One row per queue element, keeping its index (empty queues yield no rows).
    expect(query.sql).toContain(
      "CROSS JOIN LATERAL jsonb_array_elements_text(m.queue) WITH ORDINALITY AS q(node, ord)",
    );
    expect(query.sql).toContain('(q.ord - 1)::int AS "position"');
    expect(query.sql).toContain("ORDER BY m.address, q.ord");
  });

  it("only includes node-queue markets (queue_type = NODE_QUEUE)", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await new MarketsRepository().findQueuedNodes();
    const query = getCompiledQuery();

    expect(query.sql).toContain("WHERE m.queue_type = $1");
    expect(query.params).toEqual([1]);
  });
});
