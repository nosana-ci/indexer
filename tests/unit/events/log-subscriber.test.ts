/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgramLogSubscriber } from "../../../src/events/log-subscriber";

const PROGRAM = "ProgRam1111111111111111111111111111111111111";

const makeClient = (notifications: any[]) => {
  const subscribe = vi.fn().mockImplementation(async () => {
    async function* stream() {
      for (const n of notifications) yield n;
    }
    return stream();
  });
  return {
    config: { programs: { jobsAddress: PROGRAM } },
    solana: {
      rpcSubscriptions: {
        logsNotifications: vi.fn().mockReturnValue({ subscribe }),
      },
    },
  };
};

describe("ProgramLogSubscriber", () => {
  let subscriber: ProgramLogSubscriber;

  afterEach(() => subscriber?.stop());

  it("stores each notified signature with slot and failed flag", async () => {
    const repo = { insertMany: vi.fn().mockResolvedValue(1) };
    const client = makeClient([
      { context: { slot: 5n }, value: { signature: "sigA", err: null, logs: [] } },
      { context: { slot: 6n }, value: { signature: "sigB", err: { e: 1 }, logs: [] } },
    ]);
    subscriber = new ProgramLogSubscriber(client as any, { repo } as any);

    subscriber.start();

    await vi.waitFor(() => expect(repo.insertMany).toHaveBeenCalledTimes(2));
    expect(repo.insertMany).toHaveBeenNthCalledWith(1, [
      { signature: "sigA", slot: 5, blockTime: null, failed: false, status: "pending" },
    ]);
    expect(repo.insertMany).toHaveBeenNthCalledWith(2, [
      { signature: "sigB", slot: 6, blockTime: null, failed: true, status: "archived" },
    ]);
  });

  it("subscribes with the program mention and confirmed commitment", async () => {
    const repo = { insertMany: vi.fn().mockResolvedValue(1) };
    const client = makeClient([]);
    subscriber = new ProgramLogSubscriber(client as any, { repo } as any);

    subscriber.start();
    await vi.waitFor(() =>
      expect(client.solana.rpcSubscriptions.logsNotifications).toHaveBeenCalledWith(
        { mentions: [PROGRAM] },
        { commitment: "confirmed" },
      ),
    );
  });

  it("does not resubscribe after stop()", async () => {
    const repo = { insertMany: vi.fn().mockResolvedValue(1) };
    const client = makeClient([]); // empty stream ends immediately → would reconnect if running
    subscriber = new ProgramLogSubscriber(client as any, { repo } as any);

    subscriber.start();
    await vi.waitFor(() =>
      expect(client.solana.rpcSubscriptions.logsNotifications).toHaveBeenCalled(),
    );
    subscriber.stop();
    const callsAfterStop = client.solana.rpcSubscriptions.logsNotifications.mock.calls.length;

    await new Promise((r) => setTimeout(r, 50));
    expect(client.solana.rpcSubscriptions.logsNotifications.mock.calls.length).toBe(callsAfterStop);
  });
});
