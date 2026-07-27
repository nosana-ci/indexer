import { expect } from "vitest";
import {
  Address,
  createMarket,
  listJob,
  getScenarioClient,
  joinMarketQueue,
  waitForJobState,
  finishJob,
  delistJob,
} from "@nosana/scenario";
import { JobState, address as toAddress } from "@nosana/kit";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

const EXTEND_SECONDS = 1800;

type JobEvent = {
  jobAddress: string | null;
  nodeAddress: string | null;
  marketAddress: string | null;
  type: string;
  signature: string;
  instructionIndex: number;
  slot: number | null;
  blockTime: number | null;
  data: Record<string, unknown> | null;
};

async function fetchEvents(jobAddress: string): Promise<JobEvent[]> {
  const response = await fetch(`${backendUrl}/jobs/${jobAddress}/events`);
  if (response.status !== 200) return [];
  return (await response.json()) as JobEvent[];
}

// The program-level pipeline polls signatures and processes them on ~1-minute
// crons, so events lag on-chain actions by up to a couple of minutes.
async function pollUntilTypes(jobAddress: string, expected: string[]): Promise<JobEvent[]> {
  await expect
    .poll(async () => (await fetchEvents(jobAddress)).map((e) => e.type), {
      interval: 5_000,
      timeout: 180_000,
    })
    .toEqual(expect.arrayContaining(expected));
  return fetchEvents(jobAddress);
}

function eventOf(events: JobEvent[], type: string): JobEvent {
  const event = events.find((e) => e.type === type);
  if (!event) throw new Error(`missing ${type} event`);
  return event;
}

createFlow("Job events: list is recorded", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;

  step("create a market and list a job", async () => {
    await getScenarioClient();
    marketAddress = await createMarket();
    jobAddress = await listJob({ market: marketAddress });
  });

  step("a List event is indexed with tx metadata", async () => {
    const events = await pollUntilTypes(jobAddress.toString(), ["List"]);
    const list = eventOf(events, "List");
    expect(list.jobAddress).toBe(jobAddress.toString());
    expect(list.signature).toBeTruthy();
    expect(list.slot).toBeGreaterThan(0);
    expect(list.blockTime).toBeGreaterThan(0);
  });
});

createFlow("Job events: pickup, extend and finish", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;
  let nodeAddress: string;

  step("create a market, list a job, and have a node pick it up", async () => {
    await getScenarioClient();
    marketAddress = await createMarket();
    jobAddress = await listJob({ market: marketAddress });

    const nodeClient = await getScenarioClient({ key: "events-node" });
    nodeAddress = nodeClient.wallet!.address.toString();
    await joinMarketQueue(marketAddress.toString(), { verifyQueued: false }, nodeClient);
    await waitForJobState(jobAddress.toString(), JobState.RUNNING);
  });

  step("List and Work events are indexed, Work carries the node", async () => {
    const events = await pollUntilTypes(jobAddress.toString(), ["List", "Work"]);
    expect(eventOf(events, "Work").nodeAddress).toBe(nodeAddress);
  });

  step("the poster extends the job", async () => {
    const client = await getScenarioClient();
    const instruction = await client.jobs.extend({
      job: toAddress(jobAddress.toString()),
      timeout: EXTEND_SECONDS,
    });
    expect(await client.solana.buildSignAndSend(instruction)).not.toBeNull();
  });

  step("an Extend event is indexed with the new timeout", async () => {
    const events = await pollUntilTypes(jobAddress.toString(), ["List", "Work", "Extend"]);
    // The extend instruction encodes the job's new absolute timeout (original +
    // extension), so it must be a number at least as large as the extension.
    const timeout = eventOf(events, "Extend").data?.timeout;
    expect(timeout).toBeTypeOf("number");
    expect(timeout as number).toBeGreaterThanOrEqual(EXTEND_SECONDS);
  });

  step("the node finishes the job and a Finish event is indexed in order", async () => {
    const nodeClient = await getScenarioClient({ key: "events-node" });
    await finishJob(jobAddress.toString(), nodeClient);

    const events = await pollUntilTypes(jobAddress.toString(), ["List", "Work", "Extend", "Finish"]);
    const blockTimes = events.map((e) => e.blockTime ?? 0);
    expect(blockTimes).toEqual([...blockTimes].sort((a, b) => a - b));
  });
});

createFlow("Job events: delist is retained after the job row is removed", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;

  step("create a market and list a job (no nodes → QUEUED)", async () => {
    await getScenarioClient();
    marketAddress = await createMarket();
    jobAddress = await listJob({ market: marketAddress });
    await pollUntilTypes(jobAddress.toString(), ["List"]);
  });

  step("the poster delists the job", async () => {
    await delistJob(jobAddress.toString());
  });

  step("the job row is removed but the event timeline retains List + Delist", async () => {
    await expect
      .poll(async () => (await fetch(`${backendUrl}/jobs/${jobAddress}`)).status, {
        interval: 5_000,
        timeout: 120_000,
      })
      .toBe(404);

    const events = await pollUntilTypes(jobAddress.toString(), ["List", "Delist"]);
    expect(events.map((e) => e.type)).toContain("Delist");
  });
});

createFlow("Job events: poster stops a running job (End)", (step) => {
  let marketAddress: Address;
  let jobAddress: Address;

  step("list a job and have a node pick it up", async () => {
    await getScenarioClient();
    marketAddress = await createMarket();
    jobAddress = await listJob({ market: marketAddress });

    const nodeClient = await getScenarioClient({ key: "stop-node" });
    await joinMarketQueue(marketAddress.toString(), { verifyQueued: false }, nodeClient);
    await waitForJobState(jobAddress.toString(), JobState.RUNNING);
    await pollUntilTypes(jobAddress.toString(), ["List", "Work"]);
  });

  step("the poster stops the job and an End event is indexed", async () => {
    const client = await getScenarioClient();
    const instruction = await client.jobs.end({ job: toAddress(jobAddress.toString()) });
    expect(await client.solana.buildSignAndSend(instruction)).not.toBeNull();

    await pollUntilTypes(jobAddress.toString(), ["List", "Work", "End"]);
  });
});
