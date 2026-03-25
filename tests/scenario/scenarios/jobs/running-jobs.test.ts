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

createFlow("Running jobs", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;
  let walletAddress: string;
  let nodeAddress: string;

  step("create a market, list a job, and start a node", async () => {
    const client = await getScenarioClient();
    walletAddress = client.wallet!.address.toString();
    marketAddress = await createMarket();
    jobAddress = await listJob({ market: marketAddress });

    // Create a separate node client and join the queue to pick up the job
    const nodeClient = await getScenarioClient({ key: "node" });
    nodeAddress = nodeClient.wallet!.address.toString();
    await joinMarketQueue(marketAddress.toString(), { verifyQueued: false }, nodeClient);
  });

  step("wait for the running job to be indexed", async () => {
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
      .toBe(1); // RUNNING

    const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    const job = await response.json();
    expect(job.node).toBe(nodeAddress);
    expect(job.payer).toBe(walletAddress);
    expect(job.project).toBe(walletAddress);
    expect(job.price).toBe(0);
  });

  step("GET /jobs/running includes the market", async () => {
    const response = await fetch(`${backendUrl}/jobs/running`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toBeDefined();

    const marketKey = marketAddress.toString();
    expect(body[marketKey]).toBeDefined();
    expect(body[marketKey].running).toBeGreaterThan(0);
  });

  step("GET /jobs/running-nodes returns the node for the market", async () => {
    const response = await fetch(`${backendUrl}/jobs/running-nodes?market=${marketAddress}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toBeDefined();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain(nodeAddress);
  });
});
