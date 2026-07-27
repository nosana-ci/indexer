/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionProcessor } from '../../../src/events/transaction-processor';

const sig = 'Sig1111111111111111111111111111111111111111';
const jobAddress = 'Job1111111111111111111111111111111111111111';
const market = 'Market11111111111111111111111111111111111111';

const listEvent = {
  instructionIndex: 0,
  type: 'List',
  jobAddress,
  nodeAddress: null,
  marketAddress: market,
  runAddress: null,
  data: null,
};

const makeProcessor = (opts: { tx: any; decoded: any[]; claim: any[] }) => {
  const rpc = {
    getTransaction: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue(opts.tx) }),
  };
  const decoder = { decode: vi.fn().mockResolvedValue(opts.decoded) };
  const programTxRepo = {
    claimUnprocessed: vi.fn().mockResolvedValue(opts.claim),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    recordFailedAttempts: vi.fn().mockResolvedValue(0),
    countPending: vi.fn().mockResolvedValue(0),
  };
  const eventsRepo = {
    insertMany: vi.fn().mockResolvedValue(opts.decoded.length),
    resolveRunAttribution: vi.fn().mockResolvedValue(0),
  };
  const metrics = {
    recordIngested: vi.fn(),
    recordProcessed: vi.fn(),
    recordProcessError: vi.fn(),
    setPending: vi.fn(),
    setLogsConnected: vi.fn(),
  };
  const processor = new TransactionProcessor(
    { solana: { rpc } } as any,
    { decoder, programTxRepo, eventsRepo, metrics } as any,
  );
  return { processor, rpc, decoder, programTxRepo, eventsRepo, metrics };
};

const pendingRow = { signature: sig, slot: 10, blockTime: 100, failed: false };

describe('TransactionProcessor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('decodes a pending tx into program events and marks it processed', async () => {
    const { processor, eventsRepo, programTxRepo } = makeProcessor({
      tx: { transaction: {} },
      decoded: [listEvent],
      claim: [pendingRow],
    });

    const result = await processor.process();

    expect(result).toEqual({ processed: 1, events: 1 });
    expect(eventsRepo.insertMany).toHaveBeenCalledWith([
      {
        signature: sig,
        instructionIndex: 0,
        type: 'List',
        jobAddress,
        nodeAddress: null,
        marketAddress: market,
        runAddress: null,
        slot: 10,
        blockTime: 100,
        data: null,
      },
    ]);
    expect(programTxRepo.markProcessed).toHaveBeenCalledWith([sig]);
  });

  it('records non-job program activity too (e.g. a market Open)', async () => {
    const openEvent = {
      instructionIndex: 0,
      type: 'Open',
      jobAddress: null,
      nodeAddress: null,
      marketAddress: market,
      runAddress: null,
      data: null,
    };
    const { processor, eventsRepo, programTxRepo } = makeProcessor({
      tx: { transaction: {} },
      decoded: [openEvent],
      claim: [pendingRow],
    });

    await processor.process();

    expect(eventsRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'Open', jobAddress: null, marketAddress: market }),
    ]);
    expect(programTxRepo.markProcessed).toHaveBeenCalledWith([sig]);
  });

  it('uses slot/blockTime from the fetched tx (e.g. for logs-ingested rows)', async () => {
    const logsRow = { signature: sig, slot: 0, blockTime: null, failed: false };
    const { processor, eventsRepo } = makeProcessor({
      tx: { transaction: {}, slot: 42n, blockTime: 1_700_000_500n },
      decoded: [listEvent],
      claim: [logsRow],
    });

    await processor.process();

    expect(eventsRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ slot: 42, blockTime: 1_700_000_500 }),
    ]);
  });

  it('marks a tx with no Nosana instructions processed without writing rows', async () => {
    const { processor, eventsRepo, programTxRepo } = makeProcessor({
      tx: { transaction: {} },
      decoded: [],
      claim: [pendingRow],
    });

    const result = await processor.process();

    expect(result).toEqual({ processed: 1, events: 0 });
    expect(eventsRepo.insertMany).not.toHaveBeenCalled();
    expect(programTxRepo.markProcessed).toHaveBeenCalledWith([sig]);
  });

  it('records processed/pending metrics on a pass', async () => {
    const { processor, metrics } = makeProcessor({
      tx: { transaction: {} },
      decoded: [listEvent],
      claim: [pendingRow],
    });

    await processor.process();

    expect(metrics.recordProcessed).toHaveBeenCalledWith(1, 1);
    expect(metrics.setPending).toHaveBeenCalledWith(0);
    expect(metrics.recordProcessError).not.toHaveBeenCalled();
  });

  it('leaves a not-yet-available tx unprocessed for retry', async () => {
    const { processor, programTxRepo } = makeProcessor({ tx: null, decoded: [], claim: [pendingRow] });

    const result = await processor.process();

    expect(result.processed).toBe(0);
    expect(programTxRepo.markProcessed).toHaveBeenCalledWith([]);
    // ...but the attempt is counted, so it can eventually be parked instead of
    // sitting at the head of the oldest-first queue forever.
    expect(programTxRepo.recordFailedAttempts).toHaveBeenCalledWith([pendingRow.signature]);
  });

  it('does nothing when the queue is empty', async () => {
    const { processor, rpc } = makeProcessor({ tx: null, decoded: [], claim: [] });

    const result = await processor.process();

    expect(result).toEqual({ processed: 0, events: 0 });
    expect(rpc.getTransaction).not.toHaveBeenCalled();
  });
});
