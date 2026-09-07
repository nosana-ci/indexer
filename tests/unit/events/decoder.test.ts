/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const JOBS_PROGRAM = 'nosJhNRqr2bc9g1nfGDcXXTXvYUmxD4cVwy2pMWhrYM';
const jobAddress = 'Job11111111111111111111111111111111111111111';
const runAddress = 'Run11111111111111111111111111111111111111111';
const nodeAddress = 'Node1111111111111111111111111111111111111111';

// The instruction `data` string doubles as its identified type in these tests.
vi.mock('@nosana/kit', () => ({
  address: (a: string) => a,
  JobsClient: {
    // Account-index consts, mirroring the kit's IDL-generated `*_INSTRUCTION_ACCOUNTS`
    // (job/market/node/run indices only — the decoder's ENTITY_MAP reads them all at load).
    LIST_INSTRUCTION_ACCOUNTS: { job: 0, market: 1, run: 2, authority: 8 },
    DELIST_INSTRUCTION_ACCOUNTS: { job: 0, market: 1, run: 2, authority: 8 },
    EXTEND_INSTRUCTION_ACCOUNTS: { job: 0, market: 1, run: 2, authority: 7 },
    END_INSTRUCTION_ACCOUNTS: { job: 0, market: 1, run: 2, authority: 7 },
    FINISH_INSTRUCTION_ACCOUNTS: { job: 0, run: 1, market: 2, authority: 8 },
    COMPLETE_INSTRUCTION_ACCOUNTS: { job: 0 },
    QUIT_INSTRUCTION_ACCOUNTS: { job: 0, run: 1, authority: 3 },
    CLAIM_INSTRUCTION_ACCOUNTS: { job: 0, run: 1, market: 2 },
    RECOVER_INSTRUCTION_ACCOUNTS: { job: 0, market: 1 },
    ASSIGN_INSTRUCTION_ACCOUNTS: { job: 0, market: 1, run: 2, node: 3 },
    CLEAN_INSTRUCTION_ACCOUNTS: { job: 0, market: 1 },
    STOP_INSTRUCTION_ACCOUNTS: { market: 0, node: 1 },
    OPEN_INSTRUCTION_ACCOUNTS: { market: 1 },
    CLOSE_INSTRUCTION_ACCOUNTS: { market: 0 },
    UPDATE_INSTRUCTION_ACCOUNTS: { market: 0 },
    WORK_INSTRUCTION_ACCOUNTS: { run: 0, market: 1, authority: 6 },
    CLEAN_ADMIN_INSTRUCTION_ACCOUNTS: { job: 0, payer: 1, authority: 2 },
    QUIT_ADMIN_INSTRUCTION_ACCOUNTS: { run: 0, payer: 1, authority: 2 },
    CLOSE_ADMIN_INSTRUCTION_ACCOUNTS: { market: 0, vault: 1, user: 2, authority: 3 },
    identifyNosanaJobsInstruction: (bytes: Uint8Array) => {
      const name = new TextDecoder().decode(bytes);
      if (name === 'UNKNOWN') throw new Error('unidentified');
      return name;
    },
    getExtendInstructionDataDecoder: () => ({ decode: () => ({ timeout: 7200n }) }),
    fetchMaybeRunAccount: vi.fn(),
  },
}));

vi.mock('@solana/kit', () => ({
  getBase58Encoder: () => ({ encode: (d: string) => new TextEncoder().encode(d) }),
}));

import { JobEventDecoder } from '../../../src/events/decoder';
import { JobsClient } from '@nosana/kit';

const fetchMaybeRunAccount = JobsClient.fetchMaybeRunAccount as unknown as ReturnType<typeof vi.fn>;

const makeTx = (
  instructions: Array<{ programId: string; accounts: string[]; data: string }>,
  meta?: {
    accountKeys: string[];
    preBalances: (number | bigint)[];
    postBalances: (number | bigint)[];
  },
) => ({
  transaction: { message: { instructions, accountKeys: meta?.accountKeys } },
  meta: meta && { preBalances: meta.preBalances, postBalances: meta.postBalances },
});

const makeDecoder = () =>
  new JobEventDecoder({
    config: { programs: { jobsAddress: JOBS_PROGRAM } },
    solana: { rpc: {} },
  } as any);

describe('JobEventDecoder', () => {
  beforeEach(() => vi.clearAllMocks());

  const market = 'Market11111111111111111111111111111111111111';

  it('decodes a job instruction with job + market (job at index 0)', async () => {
    const tx = makeTx([{ programId: JOBS_PROGRAM, accounts: [jobAddress, market], data: 'List' }]);

    const events = await makeDecoder().decode(tx);

    expect(events).toEqual([
      {
        instructionIndex: 0,
        type: 'List',
        jobAddress,
        nodeAddress: null,
        marketAddress: market,
        runAddress: null,
        data: null,
      },
    ]);
  });

  it('extracts the timeout for an Extend', async () => {
    const tx = makeTx([{ programId: JOBS_PROGRAM, accounts: [jobAddress, market], data: 'Extend' }]);

    const [event] = await makeDecoder().decode(tx);

    expect(event.type).toBe('Extend');
    expect(event.data).toEqual({ timeout: 7200 });
  });

  it('attributes a Work event to the job + node via the run account', async () => {
    fetchMaybeRunAccount.mockResolvedValue({
      exists: true,
      data: { job: jobAddress, node: nodeAddress },
    });
    const tx = makeTx([{ programId: JOBS_PROGRAM, accounts: [runAddress, market], data: 'Work' }]);

    const [event] = await makeDecoder().decode(tx);

    expect(fetchMaybeRunAccount).toHaveBeenCalledWith({}, runAddress);
    expect(event).toEqual({
      instructionIndex: 0,
      type: 'Work',
      jobAddress,
      nodeAddress,
      marketAddress: market,
      runAddress,
      data: null,
    });
  });

  it('records a Work against its market even if the run account is gone', async () => {
    fetchMaybeRunAccount.mockResolvedValue({ exists: false });
    const tx = makeTx([{ programId: JOBS_PROGRAM, accounts: [runAddress, market], data: 'Work' }]);

    const [event] = await makeDecoder().decode(tx);

    expect(event).toMatchObject({ type: 'Work', jobAddress: null, nodeAddress: null, marketAddress: market });
  });

  it('backfills the node on a List that matched an already-queued node', async () => {
    fetchMaybeRunAccount.mockResolvedValue({
      exists: true,
      data: { job: jobAddress, node: nodeAddress },
    });
    // Mirrors real mainnet data: the run account's balance goes from 0 to
    // funded within this same List transaction — it was just created here.
    const tx = makeTx(
      [{ programId: JOBS_PROGRAM, accounts: [jobAddress, market, runAddress], data: 'List' }],
      { accountKeys: [jobAddress, market, runAddress], preBalances: [0, 0, 0], postBalances: [0, 0, 1_570_584] },
    );

    const events = await makeDecoder().decode(tx);

    expect(fetchMaybeRunAccount).toHaveBeenCalledWith({}, runAddress);
    // The node recorded here is what marks the match; the event standing in
    // for the absent Work is derived at read time, not stored.
    expect(events).toEqual([
      {
        instructionIndex: 0,
        type: 'List',
        jobAddress,
        nodeAddress,
        marketAddress: market,
        runAddress,
        data: null,
      },
    ]);
  });

  it('reads balances that arrive as bigint, which is what the RPC actually returns', async () => {
    // Regression test: lamports are branded bigints, so a `=== 0` check against
    // a number is false for every matched List and the node is never read.
    fetchMaybeRunAccount.mockResolvedValue({
      exists: true,
      data: { job: jobAddress, node: nodeAddress },
    });
    const tx = makeTx(
      [{ programId: JOBS_PROGRAM, accounts: [jobAddress, market, runAddress], data: 'List' }],
      { accountKeys: [jobAddress, market, runAddress], preBalances: [0n, 0n, 0n], postBalances: [0n, 0n, 1_570_584n] },
    );

    const [list] = await makeDecoder().decode(tx);

    expect(fetchMaybeRunAccount).toHaveBeenCalledWith({}, runAddress);
    expect(list.nodeAddress).toBe(nodeAddress);
  });

  it('skips the run lookup for a plain queued List whose balances arrive as bigint too', async () => {
    fetchMaybeRunAccount.mockResolvedValue({ exists: false });
    const tx = makeTx(
      [{ programId: JOBS_PROGRAM, accounts: [jobAddress, market, runAddress], data: 'List' }],
      { accountKeys: [jobAddress, market, runAddress], preBalances: [0n, 0n, 0n], postBalances: [0n, 0n, 0n] },
    );

    await makeDecoder().decode(tx);

    expect(fetchMaybeRunAccount).not.toHaveBeenCalled();
  });

  it('skips the run lookup entirely for a plain queued List — its run address is never touched on-chain', async () => {
    fetchMaybeRunAccount.mockResolvedValue({ exists: false });
    // Mirrors real mainnet data for an unmatched List: the run address it was
    // handed stays untouched (0 lamports before and after) — the node's
    // eventual Work later creates a *different* run pubkey, not this one.
    const tx = makeTx(
      [{ programId: JOBS_PROGRAM, accounts: [jobAddress, market, runAddress], data: 'List' }],
      { accountKeys: [jobAddress, market, runAddress], preBalances: [0, 0, 0], postBalances: [0, 0, 0] },
    );

    const events = await makeDecoder().decode(tx);

    expect(fetchMaybeRunAccount).not.toHaveBeenCalled();
    expect(events).toEqual([
      { instructionIndex: 0, type: 'List', jobAddress, nodeAddress: null, marketAddress: market, runAddress, data: null },
    ]);
  });

  it('still does the run lookup when the tx carries no balance info to check (fail open)', async () => {
    fetchMaybeRunAccount.mockResolvedValue({ exists: false });
    const tx = makeTx([
      { programId: JOBS_PROGRAM, accounts: [jobAddress, market, runAddress], data: 'List' },
    ]);

    await makeDecoder().decode(tx);

    expect(fetchMaybeRunAccount).toHaveBeenCalledWith({}, runAddress);
  });

  it('propagates a run account lookup failure so the caller retries the whole transaction', async () => {
    fetchMaybeRunAccount.mockRejectedValue(new Error('RPC unavailable'));
    const tx = makeTx(
      [{ programId: JOBS_PROGRAM, accounts: [jobAddress, market, runAddress], data: 'List' }],
      { accountKeys: [jobAddress, market, runAddress], preBalances: [0, 0, 0], postBalances: [0, 0, 1_570_584] },
    );

    await expect(makeDecoder().decode(tx)).rejects.toThrow('RPC unavailable');
  });

  it('decodes a node-queue Stop with market + node', async () => {
    const tx = makeTx([{ programId: JOBS_PROGRAM, accounts: [market, nodeAddress], data: 'Stop' }]);

    const [event] = await makeDecoder().decode(tx);

    expect(event).toMatchObject({
      type: 'Stop',
      jobAddress: null,
      nodeAddress,
      marketAddress: market,
    });
  });

  it('ignores instructions from other programs', async () => {
    const tx = makeTx([{ programId: 'OtherProgram', accounts: [jobAddress], data: 'List' }]);
    expect(await makeDecoder().decode(tx)).toEqual([]);
  });

  it('skips unidentifiable Nosana instructions', async () => {
    const tx = makeTx([{ programId: JOBS_PROGRAM, accounts: ['x'], data: 'UNKNOWN' }]);
    expect(await makeDecoder().decode(tx)).toEqual([]);
  });

  it('records every instruction in a batched transaction', async () => {
    const job2 = 'Job22222222222222222222222222222222222222222';
    const tx = makeTx([
      { programId: JOBS_PROGRAM, accounts: [jobAddress, market], data: 'End' },
      { programId: 'ComputeBudget111', accounts: [], data: 'noise' },
      { programId: JOBS_PROGRAM, accounts: [job2, market], data: 'End' },
    ]);

    const events = await makeDecoder().decode(tx);

    expect(events.map((e) => [e.instructionIndex, e.type, e.jobAddress])).toEqual([
      [0, 'End', jobAddress],
      [2, 'End', job2],
    ]);
  });
});
