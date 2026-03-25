import { expect } from "vitest";
import { Address, createMarket, listJob, getScenarioClient } from "@nosana/scenario";
import { address as toAddress } from "@nosana/kit";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

createFlow("Delist job removes it from database", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;
  let walletAddress: string;

  step("create a market and list a job (no nodes → QUEUED)", async () => {
    const client = await getScenarioClient();
    walletAddress = client.wallet!.address.toString();
    marketAddress = await createMarket();
    jobAddress = await listJob({ market: marketAddress });
  });

  step("job is indexed as QUEUED", async () => {
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
    expect(job.state).toBe(0);
    expect(job.payer).toBe(walletAddress);
    expect(job.project).toBe(walletAddress);
    expect(job.price).toBe(0);
  });

  step("delist the job from the market", async () => {
    const client = await getScenarioClient();
    const instruction = await client.jobs.delist({
      job: toAddress(jobAddress.toString()),
    });
    const tx = await client.solana.buildSignAndSend(instruction);
    expect(tx).not.toBeNull();
  });

  step("job is removed from the database", async () => {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
          return response.status;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBe(404);
  });
});
