/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramSignatureBackfiller } from "../../../src/events/signature-backfiller";

const PROGRAM = "ProgRam1111111111111111111111111111111111111";
const NOW = 1_000_000; // seconds
const TWO_WEEKS = 14 * 24 * 60 * 60;

const makeRpc = (pages: any[][]) => {
  let call = 0;
  return {
    getSignaturesForAddress: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue(pages[call++] ?? []),
    })),
  };
};

let appTasks: { isComplete: ReturnType<typeof vi.fn>; markComplete: ReturnType<typeof vi.fn> };

const makeBackfiller = (rpc: any, repo: any) =>
  new ProgramSignatureBackfiller(
    { config: { programs: { jobsAddress: PROGRAM } }, solana: { rpc } } as any,
    { repo, appTasksRepo: appTasks, now: () => NOW } as any,
  );

describe("ProgramSignatureBackfiller", () => {
  let repo: { getOldestSignature: ReturnType<typeof vi.fn>; insertMany: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    repo = {
      getOldestSignature: vi.fn().mockResolvedValue("oldestSig"),
      insertMany: vi.fn().mockResolvedValue(0),
    };
    appTasks = {
      isComplete: vi.fn().mockResolvedValue(false),
      markComplete: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("archives transactions older than the detail window and keeps recent ones pending", async () => {
    const rpc = makeRpc([
      [
        { signature: "recent", slot: 9n, blockTime: NOW - 100, err: null },
        { signature: "old", slot: 8n, blockTime: NOW - TWO_WEEKS - 100, err: null },
        { signature: "failedOld", slot: 7n, blockTime: NOW - TWO_WEEKS - 200, err: { x: 1 } },
      ],
    ]);
    const backfiller = makeBackfiller(rpc, repo);

    await backfiller.backfill(1);

    expect(repo.insertMany).toHaveBeenCalledWith([
      { signature: "recent", slot: 9, blockTime: NOW - 100, failed: false, status: "pending" },
      { signature: "old", slot: 8, blockTime: NOW - TWO_WEEKS - 100, failed: false, status: "archived" },
      {
        signature: "failedOld",
        slot: 7,
        blockTime: NOW - TWO_WEEKS - 200,
        failed: true,
        status: "archived",
      },
    ]);
  });

  it("starts from the oldest stored signature as the before cursor", async () => {
    const rpc = makeRpc([[{ signature: "s", slot: 1n, blockTime: NOW, err: null }]]);
    const backfiller = makeBackfiller(rpc, repo);

    await backfiller.backfill(1);

    expect(rpc.getSignaturesForAddress).toHaveBeenCalledWith(
      PROGRAM,
      expect.objectContaining({ before: "oldestSig" }),
    );
  });

  it("reports reachedGenesis on a short page and stops paginating", async () => {
    const rpc = makeRpc([[{ signature: "s", slot: 1n, blockTime: NOW, err: null }]]); // < PAGE_SIZE
    const backfiller = makeBackfiller(rpc, repo);

    const result = await backfiller.backfill(5);

    expect(result.reachedGenesis).toBe(true);
    expect(rpc.getSignaturesForAddress).toHaveBeenCalledTimes(1);
  });

  it("reports reachedGenesis immediately when there is nothing older", async () => {
    const rpc = makeRpc([[]]);
    const backfiller = makeBackfiller(rpc, repo);

    const result = await backfiller.backfill(5);

    expect(result).toEqual({ inserted: 0, reachedGenesis: true });
  });

  it("marks the backfill complete once genesis is reached", async () => {
    const rpc = makeRpc([[]]);
    await makeBackfiller(rpc, repo).backfill(5);
    expect(appTasks.markComplete).toHaveBeenCalledWith("program-signatures-backfill");
  });

  it("is a no-op (no RPC) once the backfill is complete", async () => {
    appTasks.isComplete.mockResolvedValue(true);
    const rpc = makeRpc([[{ signature: "s", slot: 1n, blockTime: NOW, err: null }]]);

    const result = await makeBackfiller(rpc, repo).backfill(5);

    expect(result).toEqual({ inserted: 0, reachedGenesis: true });
    expect(rpc.getSignaturesForAddress).not.toHaveBeenCalled();
    expect(repo.getOldestSignature).not.toHaveBeenCalled();
  });
});
