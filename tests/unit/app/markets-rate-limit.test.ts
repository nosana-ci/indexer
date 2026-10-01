import { describe, it, expect, vi } from "vitest";

// Real rate-limit middleware (not mocked) and the real app wiring: the jobs
// limiter must stay scoped to its /jobs group and never reach /markets/*.
vi.mock("../../../src/modules/jobs/service", () => ({
  JobsService: class {
    getJobs = vi.fn().mockResolvedValue({ jobs: [], totalJobs: 0 });
  },
}));

vi.mock("../../../src/modules/markets/service", () => ({
  MarketsService: class {
    getQueuedNodes = vi.fn().mockResolvedValue([]);
    getRunningNodes = vi.fn().mockResolvedValue([]);
  },
}));

import { createApp } from "../../../src/app";

// Above the tightest jobs limit (20 per 30s per IP).
const REQUESTS = 30;

async function statusesFor(app: ReturnType<typeof createApp>, path: string, ip: string) {
  const statuses: number[] = [];
  for (let i = 0; i < REQUESTS; i++) {
    const res = await app.handle(
      new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": ip } }),
    );
    statuses.push(res.status);
  }
  return statuses;
}

describe("Rate limiting scope", () => {
  const app = createApp();

  it("limits the rate-limited /jobs group (control)", async () => {
    const statuses = await statusesFor(app, "/jobs", "10.0.0.1");
    expect(statuses).toContain(429);
  });

  it.each(["/markets/queued-nodes", "/markets/running-nodes"])(
    "does not rate limit %s",
    async (path) => {
      const statuses = await statusesFor(app, path, "10.0.0.2");
      expect(statuses.every((s) => s === 200)).toBe(true);
    },
  );
});
