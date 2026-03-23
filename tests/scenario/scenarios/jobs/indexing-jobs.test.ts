import { expect } from "vitest";
import { Address, createMarket, listJob } from "@nosana/scenario";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

createFlow("indexing: list a job and index it", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;

  step("create a market on-chain", async () => {
    marketAddress = await createMarket();
  });

  step("list a job on the market", async () => {
    jobAddress = await listJob({
      market: marketAddress,
    });
  });

  step("job appears in the API after indexing", async () => {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
          return response.status;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBe(200);

    const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    const job = await response.json();
    expect(job.address).toBe(jobAddress.toString());
    expect(job.market).toBe(marketAddress.toString());
  });

  step("GET /jobs/invalid-address returns 404", async () => {
    const response = await fetch(`${backendUrl}/jobs/invalid-address`);
    expect(response.status).toBe(404);
  });
});
