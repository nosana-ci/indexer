import { execSync } from "child_process";
import { startLocalnet, stopLocalnet } from "@nosana/scenario";

const DOCKER_COMPOSE_DIR = `${process.cwd()}/docker`;
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3003";
const CRON_URL = process.env.CRON_URL ?? "http://localhost:3005";
const DOCKER_COMPOSE_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_POLL_INTERVAL_MS = 2_000;

const LOCALNET_ENV = {
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC: "http://host.docker.internal:8899",
  SOLANA_WS: "ws://host.docker.internal:8900",
};

function dc(cmd: string, timeoutMs = DOCKER_COMPOSE_TIMEOUT_MS): string {
  return execSync(`docker compose ${cmd}`, {
    cwd: DOCKER_COMPOSE_DIR,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...LOCALNET_ENV },
  }).trim();
}

function isStackRunning(): boolean {
  try {
    const output = dc("ps --format json");
    if (!output) return false;
    const services = output
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const appServices = services.filter((s: { Service: string }) =>
      ["api", "indexer", "cron"].includes(s.Service),
    );
    return (
      appServices.length === 3 &&
      appServices.every((s: { State: string }) => s.State === "running")
    );
  } catch {
    return false;
  }
}

async function waitForHealthy(): Promise<void> {
  const endpoints = [
    { name: "api", url: `${BACKEND_URL}/health` },
    { name: "cron", url: `${CRON_URL}/health` },
  ];

  for (const endpoint of endpoints) {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(endpoint.url);
        if (res.ok) break;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${endpoint.name} at ${endpoint.url} not healthy after ${HEALTH_TIMEOUT_MS / 1000}s`,
      );
    }
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const wasRunning = isStackRunning();

  // Start the Nosana localnet validator (Solana)
  console.log("Starting Nosana localnet...");
  startLocalnet({ verbose: false });
  console.log("Nosana localnet started");

  if (wasRunning) {
    console.log(
      "Dev environment already running — rebuilding to pick up changes",
    );
    dc("up -d --build --wait");
  } else {
    console.log("Dev environment not running — starting it");
    dc("up -d --build --wait");
  }

  await waitForHealthy();
  console.log("All services healthy");

  return async () => {
    console.log("Stopping Nosana localnet...");
    stopLocalnet();

    if (!wasRunning) {
      console.log("Stopping dev environment (tests started it)");
      dc("down");
    } else {
      console.log("Leaving dev environment running (was already running)");
    }
  };
}
