import { expect } from "vitest";
import {
  Address,
  createMarket,
  listJob,
  getScenarioClient,
  joinMarketQueue,
  finishJob,
} from "@nosana/scenario";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

const DEFAULT_IPFS_HASH = "QmVp8m3Uq1Cm6JJ3NsuTMSGLNnqXa1mC85uV7YxBREQ78p";
const DEFAULT_TIMEOUT = 3600;
const FINISH_IPFS_HASH = "QmV2iq3gexzSwPAbhBAPVDip7Pu6k7whECUa4wzUjnPtdA";

createFlow("Job lifecycle: queued → running → completed", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;
  let nodeAddress: string;
  let walletAddress: string;
  let listedAtTimestamp: number;

  step("create a market and list a job", async () => {
    const client = await getScenarioClient();
    walletAddress = client.wallet!.address.toString();
    marketAddress = await createMarket();
    listedAtTimestamp = Math.floor(Date.now() / 1000);
    jobAddress = await listJob({ market: marketAddress });
  });

  step("job is indexed as QUEUED with correct on-chain fields", async () => {
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

    // State
    expect(job.state).toBe(0); // QUEUED — empty market, no nodes

    // Addresses
    expect(job.address).toBe(jobAddress.toString());
    expect(job.market).toBe(marketAddress.toString());

    // On-chain defaults for a queued job
    expect(job.ipfsJob).toBe(DEFAULT_IPFS_HASH);
    expect(job.ipfsResult).toBeNull();
    expect(job.timeout).toBe(DEFAULT_TIMEOUT);
    expect(job.price).toBe(0);
    expect(job.timeStart).toBe(0);
    expect(job.timeEnd).toBe(0);

    // payer and project should be the default scenario client's wallet
    expect(job.payer).toBe(walletAddress);
    expect(job.project).toBe(walletAddress);

    // Derived fields not yet filled (processing hasn't completed)
    expect(job.jobStatus).toBeNull();
  });

  step("job is processed: listedAt and jobDefinition get filled", async () => {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
          if (response.status !== 200) return null;
          const job = await response.json();
          return job.listedAt;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBeTypeOf("number");

    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
          if (response.status !== 200) return null;
          const job = await response.json();
          return job.jobDefinition;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBeTruthy();

    const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    const job = await response.json();

    expect(job.listedAt).toBeGreaterThan(0);
    // listedAt should be close to when we actually listed the job (within 30s)
    expect(job.listedAt).toBeGreaterThanOrEqual(listedAtTimestamp - 30);
    expect(job.listedAt).toBeLessThanOrEqual(listedAtTimestamp + 30);
    expect(job.jobDefinition).toBeTruthy();
  });

  step("node joins the market queue and picks up the job", async () => {
    const nodeClient = await getScenarioClient({ key: "lifecycle-node" });
    nodeAddress = nodeClient.wallet!.address.toString();
    await joinMarketQueue(marketAddress.toString(), { verifyQueued: false }, nodeClient);
  });

  step("job transitions to RUNNING with timeStart and node filled", async () => {
    const beforeJoin = Math.floor(Date.now() / 1000);

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
    expect(job.timeStart).toBeGreaterThan(0);
    // timeStart should be reasonably recent (within 60s of when the node joined)
    expect(job.timeStart).toBeGreaterThanOrEqual(beforeJoin - 60);
  });

  step("node finishes the job", async () => {
    const nodeClient = await getScenarioClient({ key: "lifecycle-node" });
    await finishJob(jobAddress.toString(), nodeClient);
  });

  step("job transitions to COMPLETED with ipfsResult filled", async () => {
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
      .toBe(2); // COMPLETED

    const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    const job = await response.json();

    expect(job.ipfsResult).toBe(FINISH_IPFS_HASH);
    expect(job.timeEnd).toBeGreaterThan(0);
    expect(job.timeEnd).toBeGreaterThanOrEqual(job.timeStart);
  });

  step("completed job is processed: jobResult and jobStatus get filled", async () => {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
          if (response.status !== 200) return null;
          const job = await response.json();
          return job.jobResult;
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toBeTruthy();

    const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    const job = await response.json();

    expect(job.jobResult).toBeTruthy();
    expect(job.jobStatus).toBeTruthy();
  });
});
