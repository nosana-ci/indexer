import { expect } from "vitest";
import { Address, createMarket, listJob } from "@nosana/scenario";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

createFlow("List jobs", (step) => {
  let marketAddress: Address;
  let jobAddress1: Address;
  let jobAddress2: Address;

  step("create a market and list two jobs on-chain", async () => {
    marketAddress = await createMarket();
    jobAddress1 = await listJob({ market: marketAddress });
    jobAddress2 = await listJob({ market: marketAddress });
  });

  step("wait for jobs to be indexed", async () => {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/jobs/${jobAddress2}`);
          return response.status;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBe(200);
  });

  step("GET /jobs returns 200 with array", async () => {
    const response = await fetch(`${backendUrl}/jobs`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.jobs.length).toBeGreaterThanOrEqual(2);
  });

  step("GET /jobs?market=<address> filters by market", async () => {
    const response = await fetch(`${backendUrl}/jobs?market=${marketAddress}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.jobs.length).toBe(2);

    for (const job of body.jobs) {
      expect(job.market).toBe(marketAddress.toString());
    }
  });

  step("GET /jobs?state=QUEUED returns queued jobs", async () => {
    const response = await fetch(`${backendUrl}/jobs?state=QUEUED&market=${marketAddress}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.jobs.length).toBe(2);

    for (const job of body.jobs) {
      expect(job.state).toBe(0);
    }
  });

  step("GET /jobs?limit=1 respects limit", async () => {
    const response = await fetch(`${backendUrl}/jobs?limit=1&market=${marketAddress}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.jobs.length).toBe(1);
  });
});
