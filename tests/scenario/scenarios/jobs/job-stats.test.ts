import { expect } from "vitest";
import { Address, createMarket, listJob } from "@nosana/scenario";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

createFlow("Job statistics", (step) => {
  let marketAddress: Address;

  step("create a market and list a job on-chain", async () => {
    marketAddress = await createMarket();
    const jobAddress = await listJob({ market: marketAddress });

    // Wait for the job to be indexed
    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
          return response.status;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBe(200);
  });

  step("GET /jobs/count returns counts including the new job", async () => {
    const response = await fetch(`${backendUrl}/jobs/count?market=${marketAddress}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.byState).toHaveProperty("QUEUED");
    expect(body.byState).toHaveProperty("RUNNING");
    expect(body.byState).toHaveProperty("COMPLETED");
    expect(body.byState).toHaveProperty("STOPPED");
    expect(body.byState.QUEUED).toBeGreaterThan(0);
  });

  step("GET /jobs/stats returns aggregated statistics", async () => {
    const response = await fetch(`${backendUrl}/jobs/stats`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toBeDefined();
    expect(body.retrieved).toBeGreaterThan(0);
  });

  step("GET /jobs/stats/timestamps returns timestamp data", async () => {
    const response = await fetch(`${backendUrl}/jobs/stats/timestamps`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(typeof body.total).toBe("number");
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
