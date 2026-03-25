import { expect } from "vitest";
import {
  Address,
  createMarket,
  listJob,
  getScenarioClient,
  joinMarketQueue,
} from "@nosana/scenario";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

createFlow("Job in market with queued node starts immediately", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;
  let nodeAddress: string;
  let walletAddress: string;
  let listedAtTimestamp: number;

  step("create a market and have a node join the queue first", async () => {
    const client = await getScenarioClient();
    walletAddress = client.wallet!.address.toString();
    marketAddress = await createMarket();

    const nodeClient = await getScenarioClient({ key: "immediate-node" });
    nodeAddress = nodeClient.wallet!.address.toString();
    await joinMarketQueue(marketAddress.toString(), undefined, nodeClient);
  });

  step("list a job — it should be picked up immediately", async () => {
    listedAtTimestamp = Math.floor(Date.now() / 1000);
    jobAddress = await listJob({ market: marketAddress });
  });

  step("job is indexed as RUNNING with correct node and start time", async () => {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
          if (response.status !== 200) return -1;
          const job = await response.json();
          return job.state;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBe(1); // RUNNING — node was already waiting

    const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    const job = await response.json();

    expect(job.state).toBe(1);
    expect(job.node).toBe(nodeAddress);
    expect(job.timeStart).toBeGreaterThan(0);
    expect(job.market).toBe(marketAddress.toString());
    expect(job.payer).toBe(walletAddress);
    expect(job.project).toBe(walletAddress);
    expect(job.price).toBe(0);

    // Wait for processing to fill in listedAt and verify it's close to when we listed
    await expect
      .poll(
        async () => {
          const r = await fetch(`${backendUrl}/jobs/${jobAddress}`);
          if (r.status !== 200) return null;
          const j = await r.json();
          return j.listedAt;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBeTypeOf("number");

    const listedRes = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    const listedJob = await listedRes.json();
    expect(listedJob.listedAt).toBeGreaterThanOrEqual(listedAtTimestamp - 30);
    expect(listedJob.listedAt).toBeLessThanOrEqual(listedAtTimestamp + 30);
  });
});
