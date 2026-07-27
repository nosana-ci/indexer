/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramSignaturePoller } from '../../../src/events/signature-poller';

const PROGRAM = 'ProgRam1111111111111111111111111111111111111';
// Fixed clock so the decode-window cutoff is deterministic.
const NOW = 1_800_000_000;

const makeRpc = (pages: any[][]) => {
  let call = 0;
  return {
    getSignaturesForAddress: vi.fn().mockImplementation((_addr: string, _opts: any) => ({
      send: vi.fn().mockResolvedValue(pages[call++] ?? []),
    })),
  };
};

/** An in-memory stand-in for the `indexer_cursors` table. */
const makeCursors = (initial: Record<string, string> = {}) => {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    clear: vi.fn(async (key: string) => void store.delete(key)),
  };
};

const fullPage = (prefix: string) =>
  Array.from({ length: 1000 }, (_, i) => ({
    signature: `${prefix}${i}`,
    slot: BigInt(i),
    blockTime: null,
    err: null,
  }));

const makePoller = (rpc: any, repo: any, cursors: any) =>
  new ProgramSignaturePoller(
    { config: { programs: { jobsAddress: PROGRAM } }, solana: { rpc } } as any,
    { repo, cursors, now: () => NOW } as any,
  );

describe('ProgramSignaturePoller', () => {
  let repo: { insertMany: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    repo = { insertMany: vi.fn().mockResolvedValue(0) };
  });

  it('seeds from the newest page only (no until) when there is no watermark', async () => {
    const rpc = makeRpc([[{ signature: 'a', slot: 10n, blockTime: 100n, err: null }]]);
    repo.insertMany.mockResolvedValue(1);
    const cursors = makeCursors();

    const inserted = await makePoller(rpc, repo, cursors).poll();

    expect(inserted).toBe(1);
    expect(rpc.getSignaturesForAddress).toHaveBeenCalledTimes(1);
    expect(rpc.getSignaturesForAddress.mock.calls[0][1]).not.toHaveProperty('until');
    // The newest signature of the seed page becomes the watermark.
    expect(cursors.store.get('program-signatures-poll')).toBe('a');
  });

  it('maps slot/blockTime/err and flags failed transactions', async () => {
    const rpc = makeRpc([
      [
        { signature: 'ok', slot: 5n, blockTime: BigInt(NOW - 60), err: null },
        { signature: 'bad', slot: 6n, blockTime: null, err: { InstructionError: [0, 'x'] } },
      ],
    ]);
    repo.insertMany.mockResolvedValue(2);

    await makePoller(rpc, repo, makeCursors()).poll();

    expect(repo.insertMany).toHaveBeenCalledWith([
      { signature: 'ok', slot: 5, blockTime: NOW - 60, failed: false, status: 'pending' },
      { signature: 'bad', slot: 6, blockTime: null, failed: true, status: 'archived' },
    ]);
  });

  it('archives signatures older than the decode window instead of queueing them', async () => {
    // A descent after a long outage reaches back past the two-week window; the
    // RPC will not serve getTransaction for those, so they must not go pending.
    const old = NOW - 20 * 24 * 60 * 60;
    const rpc = makeRpc([
      [
        { signature: 'recent', slot: 9n, blockTime: BigInt(NOW - 120), err: null },
        { signature: 'ancient', slot: 8n, blockTime: BigInt(old), err: null },
        { signature: 'noBlockTime', slot: 7n, blockTime: null, err: null },
      ],
    ]);

    await makePoller(rpc, repo, makeCursors()).poll();

    expect(repo.insertMany.mock.calls[0][0].map((r: any) => [r.signature, r.status])).toEqual([
      ['recent', 'pending'],
      ['ancient', 'archived'],
      ['noBlockTime', 'archived'],
    ]);
  });

  it('descends from the tip to its own watermark and advances it', async () => {
    const cursors = makeCursors({ 'program-signatures-poll': 'cursorSig' });
    const rpc = makeRpc([[{ signature: 'newer', slot: 9n, blockTime: 90n, err: null }]]);
    repo.insertMany.mockResolvedValue(1);

    await makePoller(rpc, repo, cursors).poll();

    expect(rpc.getSignaturesForAddress).toHaveBeenCalledWith(
      PROGRAM,
      expect.objectContaining({ until: 'cursorSig' }),
    );
    expect(cursors.store.get('program-signatures-poll')).toBe('newer');
  });

  it('leaves the watermark untouched when nothing new landed', async () => {
    const cursors = makeCursors({ 'program-signatures-poll': 'cursorSig' });

    await makePoller(makeRpc([[]]), repo, cursors).poll();

    expect(cursors.store.get('program-signatures-poll')).toBe('cursorSig');
  });

  it('paginates with before until a short page is returned', async () => {
    const cursors = makeCursors({ 'program-signatures-poll': 'cursor' });
    const rpc = makeRpc([
      fullPage('s'),
      [{ signature: 'last', slot: 2000n, blockTime: null, err: null }],
    ]);
    repo.insertMany.mockResolvedValue(1);

    await makePoller(rpc, repo, cursors).poll();

    expect(rpc.getSignaturesForAddress).toHaveBeenCalledTimes(2);
    // Second page continues before the last signature of the first page.
    expect(rpc.getSignaturesForAddress.mock.calls[1][1]).toEqual(
      expect.objectContaining({ before: 's999', until: 'cursor' }),
    );
    // The watermark becomes the newest signature of the whole descent.
    expect(cursors.store.get('program-signatures-poll')).toBe('s0');
  });

  it('ignores signatures the logs subscription stored, so downtime gaps are still fetched', async () => {
    // After an outage the subscriber writes a fresh signature into
    // program_transactions. The poll must keep using its own watermark from
    // before the outage, or the whole outage window is skipped.
    const cursors = makeCursors({ 'program-signatures-poll': 'beforeOutage' });
    const rpc = makeRpc([[{ signature: 'duringOutage', slot: 50n, blockTime: null, err: null }]]);

    await makePoller(rpc, repo, cursors).poll();

    expect(rpc.getSignaturesForAddress.mock.calls[0][1]).toEqual(
      expect.objectContaining({ until: 'beforeOutage' }),
    );
  });

  it('records where a capped descent stopped without advancing the watermark', async () => {
    const cursors = makeCursors({ 'program-signatures-poll': 'cursor' });
    // Every page is full, so the descent never reaches the watermark.
    const rpc = makeRpc(Array.from({ length: 20 }, (_, p) => fullPage(`p${p}_`)));
    repo.insertMany.mockResolvedValue(1000);

    await makePoller(rpc, repo, cursors).poll();

    expect(rpc.getSignaturesForAddress).toHaveBeenCalledTimes(20);
    expect(cursors.store.get('program-signatures-poll')).toBe('cursor');
    expect(cursors.store.get('program-signatures-poll-tip')).toBe('p0_0');
    expect(cursors.store.get('program-signatures-poll-before')).toBe('p19_999');
  });

  it('clears the descent before promoting the watermark, so a crash between the two replays', async () => {
    // If the watermark reached the tip while the resume position still pointed
    // below it, every later poll would ask for an `until` unreachable from
    // `before` and walk toward genesis instead of ingesting new signatures.
    const cursors = makeCursors({
      'program-signatures-poll': 'cursor',
      'program-signatures-poll-tip': 'originalTip',
      'program-signatures-poll-before': 'stoppedAt',
    });
    const writes: string[] = [];
    cursors.set.mockImplementation(async (key: string, value: string) => {
      writes.push(`set:${key}`);
      cursors.store.set(key, value);
    });
    cursors.clear.mockImplementation(async (key: string) => {
      writes.push(`clear:${key}`);
      cursors.store.delete(key);
    });

    await makePoller(makeRpc([[{ signature: 'older', slot: 1n, blockTime: null, err: null }]]), repo, cursors).poll();

    expect(writes.indexOf('clear:program-signatures-poll-before')).toBeLessThan(
      writes.indexOf('set:program-signatures-poll'),
    );
  });

  it('resumes an interrupted descent instead of re-walking from the tip', async () => {
    const cursors = makeCursors({
      'program-signatures-poll': 'cursor',
      'program-signatures-poll-tip': 'originalTip',
      'program-signatures-poll-before': 'stoppedAt',
    });
    const rpc = makeRpc([[{ signature: 'older', slot: 1n, blockTime: null, err: null }]]);
    repo.insertMany.mockResolvedValue(1);

    await makePoller(rpc, repo, cursors).poll();

    // Picks up from the recorded position rather than the current tip.
    expect(rpc.getSignaturesForAddress.mock.calls[0][1]).toEqual(
      expect.objectContaining({ before: 'stoppedAt', until: 'cursor' }),
    );
    // Completing the descent promotes the tip it was working toward, and the
    // resume state is cleared.
    expect(cursors.store.get('program-signatures-poll')).toBe('originalTip');
    expect(cursors.store.has('program-signatures-poll-tip')).toBe(false);
    expect(cursors.store.has('program-signatures-poll-before')).toBe(false);
  });
});
