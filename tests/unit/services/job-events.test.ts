import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindByJob, mockFindByAddress } = vi.hoisted(() => ({
  mockFindByJob: vi.fn(),
  mockFindByAddress: vi.fn(),
}));

vi.mock("../../../src/repositories/program-events.repository", () => ({
  default: class {
    findByJob = mockFindByJob;
  },
}));

vi.mock("../../../src/repositories/jobs.repository", () => ({
  default: class {
    findByAddress = mockFindByAddress;
  },
}));

import { JobsService } from "../../../src/modules/jobs/service";

const JOB = "Job11111111111111111111111111111111111111111";
const NODE = "Node1111111111111111111111111111111111111111";
const MARKET = "Market11111111111111111111111111111111111111";
// A run is a fresh keypair per attempt, not a PDA: an instant match keeps
// LIST_RUN for the job's life, whereas a queued List's LIST_RUN is a throwaway
// and the node's later Work brings WORK_RUN instead.
const LIST_RUN = "RunA1111111111111111111111111111111111111111";
const WORK_RUN = "RunB1111111111111111111111111111111111111111";

let instructionIndex = 0;

const event = (type: string, overrides: Record<string, unknown> = {}) => ({
  id: ++instructionIndex,
  signature: `sig-${type}`,
  instructionIndex: 0,
  type,
  jobAddress: JOB,
  nodeAddress: null,
  marketAddress: MARKET,
  runAddress: null,
  slot: 100 + instructionIndex,
  blockTime: 1_700_000_000 + instructionIndex,
  data: null,
  ...overrides,
});

const getEvents = (events: unknown[]) => {
  mockFindByJob.mockResolvedValueOnce(events);
  return new JobsService().getEventsByAddress(JOB);
};

beforeEach(() => {
  vi.clearAllMocks();
  instructionIndex = 0;
});

describe("JobsService.getEventsByAddress", () => {
  it("adds a pickup event to a job the market matched at list time", async () => {
    // The decoder read the node off the run account the List had just created.
    const list = event("List", { runAddress: LIST_RUN, nodeAddress: NODE });

    const events = await getEvents([list]);

    expect(events).toEqual([
      expect.objectContaining({ type: "List", nodeAddress: NODE }),
      {
        type: "Work",
        nodeAddress: NODE,
        jobAddress: JOB,
        marketAddress: MARKET,
        runAddress: LIST_RUN,
        // The List's transaction, where the pickup happened, with an index
        // that keeps it ordered directly after.
        signature: list.signature,
        instructionIndex: 1_000_000,
        slot: list.slot,
        blockTime: list.blockTime,
        data: { synthetic: true },
      },
    ]);
    expect(mockFindByAddress).not.toHaveBeenCalled();
  });

  it("leaves an ordinary job-queue pickup alone — it already has a real Work", async () => {
    // Regression test: "no Work shares this run" is true for every ordinary
    // job too, since the List's run is a throwaway. Treating that as a match
    // fabricates a duplicate pickup, at the wrong timestamp, for every job.
    const events = await getEvents([
      event("List", { runAddress: LIST_RUN }),
      event("Work", { runAddress: WORK_RUN, nodeAddress: NODE, instructionIndex: 1 }),
    ]);

    expect(events.map((e) => e.type)).toEqual(["List", "Work"]);
    expect(events[1].data).toBeNull();
  });

  it("takes the node from a sibling on the same run when the List was decoded after the run closed", async () => {
    // Backfill: nothing to read off the run account by then, but the Finish
    // that settled the job carries both the node and the List's own run.
    const events = await getEvents([
      event("List", { runAddress: LIST_RUN }),
      event("Finish", { runAddress: LIST_RUN, nodeAddress: NODE, instructionIndex: 2 }),
    ]);

    expect(events.map((e) => e.type)).toEqual(["List", "Work", "Finish"]);
    expect(events[1]).toMatchObject({ nodeAddress: NODE, data: { synthetic: true } });
  });

  it("falls back to the job row's node when no event ever carried it (matched, then ended)", async () => {
    // `end` is signed by the poster, so a job matched at list time and stopped
    // before finishing has the node nowhere on chain.
    mockFindByAddress.mockResolvedValueOnce({ address: JOB, node: NODE });

    const events = await getEvents([
      event("List", { runAddress: LIST_RUN }),
      event("End", { runAddress: LIST_RUN, instructionIndex: 3 }),
    ]);

    expect(events.map((e) => e.type)).toEqual(["List", "Work", "End"]);
    expect(events[1]).toMatchObject({ nodeAddress: NODE, data: { synthetic: true } });
  });

  it("adds no pickup when the job row holds the zero-address sentinel of a never-matched job", async () => {
    mockFindByAddress.mockResolvedValueOnce({
      address: JOB,
      node: "11111111111111111111111111111111",
    });

    const events = await getEvents([
      event("List", { runAddress: LIST_RUN }),
      event("End", { runAddress: LIST_RUN, instructionIndex: 3 }),
    ]);

    expect(events.map((e) => e.type)).toEqual(["List", "End"]);
  });

  it("adds no pickup when the job row is gone entirely", async () => {
    mockFindByAddress.mockResolvedValueOnce(undefined);

    const events = await getEvents([
      event("List", { runAddress: LIST_RUN }),
      event("End", { runAddress: LIST_RUN, instructionIndex: 3 }),
    ]);

    expect(events.map((e) => e.type)).toEqual(["List", "End"]);
  });

  it("adds no pickup to a job that queued and was delisted", async () => {
    const events = await getEvents([
      event("List", { runAddress: LIST_RUN }),
      event("Delist", { instructionIndex: 1 }),
    ]);

    expect(events.map((e) => e.type)).toEqual(["List", "Delist"]);
    expect(mockFindByAddress).not.toHaveBeenCalled();
  });

  it("adds no pickup to a job still sitting in the queue", async () => {
    const events = await getEvents([event("List", { runAddress: LIST_RUN })]);

    expect(events.map((e) => e.type)).toEqual(["List"]);
    expect(mockFindByAddress).not.toHaveBeenCalled();
  });

  it("does not double up when a synthetic Work is already stored on the run", async () => {
    const events = await getEvents([
      event("List", { runAddress: LIST_RUN, nodeAddress: NODE }),
      event("Work", {
        runAddress: LIST_RUN,
        nodeAddress: NODE,
        instructionIndex: 1_000_000,
        data: { synthetic: true },
      }),
    ]);

    expect(events.map((e) => e.type)).toEqual(["List", "Work"]);
  });

  it("returns an empty list for a job indexed before the pipeline existed", async () => {
    expect(await getEvents([])).toEqual([]);
  });
});
