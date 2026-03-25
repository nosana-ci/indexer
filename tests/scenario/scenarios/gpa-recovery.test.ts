import { expect } from "vitest";
import { execSync } from "child_process";
import { Address, createMarket, listJob } from "@nosana/scenario";

import { backendUrl } from "../setup.js";
import { createFlow } from "../utils/index.js";

const DOCKER_COMPOSE_DIR = `${process.cwd()}/docker`;

const LOCALNET_ENV = {
  SOLANA_NETWORK: "localnet",
  SOLANA_RPC: "http://host.docker.internal:8899",
  SOLANA_WS: "ws://host.docker.internal:8900",
};

function dc(cmd: string): string {
  return execSync(`docker compose ${cmd}`, {
    cwd: DOCKER_COMPOSE_DIR,
    encoding: "utf-8",
    timeout: 60_000,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...LOCALNET_ENV },
  }).trim();
}

async function waitForService(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`Service at ${url} not healthy after ${timeoutMs / 1000}s`);
}

createFlow("GPA recovery: indexer catches missed jobs on restart", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;

  step("create a market while everything is still running", async () => {
    marketAddress = await createMarket();
  });

  step("stop the indexer and cron containers", async () => {
    dc("stop indexer cron");
  });

  step("list a job while indexer is down", async () => {
    jobAddress = await listJob({ market: marketAddress });
  });

  step("API does not have the job (indexer was down)", async () => {
    // Give a few seconds to confirm it truly isn't indexed
    await new Promise((r) => setTimeout(r, 3_000));

    const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    expect(response.status).toBe(404);
  });

  step("restart the indexer container (runs jobsGPA on startup)", async () => {
    dc("start indexer");
    await waitForService(`http://localhost:3004/health`);
  });

  step("job appears after GPA recovery", async () => {
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
    expect(job.state).toBe(0); // QUEUED — no nodes in the market
  });

  step("restart the cron container to restore normal state", async () => {
    dc("start cron");
    await waitForService("http://localhost:3005/health");
  });
});
