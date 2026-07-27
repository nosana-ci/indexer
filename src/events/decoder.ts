import { type NosanaClient, JobsClient, address } from "@nosana/kit";
import { getBase58Encoder, type Signature } from "@solana/kit";
import parentLogger from "../logger";

const logger = parentLogger.child({ module: "event-decoder" });
const base58 = getBase58Encoder();

/**
 * Which account holds the job / market / node for each Nosana Jobs instruction.
 * Indices are pulled from the kit's generated `*_INSTRUCTION_ACCOUNTS` consts, so
 * they track the program IDL's account order instead of being hand-coded.
 *
 * `Work` and `QuitAdmin` reference only a run account; the job and node are read
 * from that run (see `run`). The map is exhaustive over `NosanaJobsInstruction`,
 * so a kit upgrade that adds or renames an instruction is a compile error rather
 * than a silent stream of events with no addresses attached.
 */
type Entity = "job" | "market" | "node" | "run";
type Entities = Partial<Record<Entity, number>>;
type EntitySpec = Entities;

/** Pick the entity indices we track out of a kit `*_INSTRUCTION_ACCOUNTS` const. */
function track<A, K extends Entity & keyof A>(accounts: A, ...keys: K[]): Entities {
  return Object.fromEntries(keys.map((k) => [k, accounts[k]])) as Entities;
}

const ENTITY_MAP = {
  List: track(JobsClient.LIST_INSTRUCTION_ACCOUNTS, "job", "market", "run"),
  Delist: track(JobsClient.DELIST_INSTRUCTION_ACCOUNTS, "job", "market"),
  Extend: track(JobsClient.EXTEND_INSTRUCTION_ACCOUNTS, "job", "market"),
  End: track(JobsClient.END_INSTRUCTION_ACCOUNTS, "job", "market", "run"),
  // The node submits its own result, so `authority` is the node. That matters
  // for jobs matched at list time (a market with a node queue): there is no
  // Work instruction in that path, so Finish is the only place the node appears
  // outside the run account. Verified against mainnet — the signer of a Finish
  // equals the `node` field of the job account it settles.
  Finish: {
    ...track(JobsClient.FINISH_INSTRUCTION_ACCOUNTS, "job", "market", "run"),
    node: JobsClient.FINISH_INSTRUCTION_ACCOUNTS.authority,
  },
  Complete: track(JobsClient.COMPLETE_INSTRUCTION_ACCOUNTS, "job"),
  Quit: track(JobsClient.QUIT_INSTRUCTION_ACCOUNTS, "job", "run"),
  Claim: track(JobsClient.CLAIM_INSTRUCTION_ACCOUNTS, "job", "market", "run"),
  Recover: track(JobsClient.RECOVER_INSTRUCTION_ACCOUNTS, "job", "market"),
  Assign: track(JobsClient.ASSIGN_INSTRUCTION_ACCOUNTS, "job", "market", "node", "run"),
  Clean: track(JobsClient.CLEAN_INSTRUCTION_ACCOUNTS, "job", "market"),
  Stop: track(JobsClient.STOP_INSTRUCTION_ACCOUNTS, "market", "node"),
  Open: track(JobsClient.OPEN_INSTRUCTION_ACCOUNTS, "market"),
  Close: track(JobsClient.CLOSE_INSTRUCTION_ACCOUNTS, "market"),
  Update: track(JobsClient.UPDATE_INSTRUCTION_ACCOUNTS, "market"),
  // The node signs its own `work`, so `authority` is the node even when the run
  // account it passed has since been closed.
  Work: {
    ...track(JobsClient.WORK_INSTRUCTION_ACCOUNTS, "market", "run"),
    node: JobsClient.WORK_INSTRUCTION_ACCOUNTS.authority,
  },
  // Admin variants of the job lifecycle — submitted by the job cleaner, so they
  // carry the terminal event for jobs that were never cleaned by their poster.
  CleanAdmin: track(JobsClient.CLEAN_ADMIN_INSTRUCTION_ACCOUNTS, "job"),
  CloseAdmin: track(JobsClient.CLOSE_ADMIN_INSTRUCTION_ACCOUNTS, "market"),
  QuitAdmin: track(JobsClient.QUIT_ADMIN_INSTRUCTION_ACCOUNTS, "run"),
} satisfies Record<JobsClient.NosanaJobsInstruction, EntitySpec>;

export interface DecodedEvent {
  instructionIndex: number;
  type: string;
  jobAddress: string | null;
  nodeAddress: string | null;
  marketAddress: string | null;
  runAddress: string | null;
  data: Record<string, unknown> | null;
}

// jsonParsed shape for an instruction of a program the RPC can't parse.
interface RawInstruction {
  programId?: string;
  accounts?: string[];
  data?: string;
}

/**
 * Decodes every identifiable Nosana Jobs instruction in a transaction into a
 * program event with the job / node / market it references. `Work` pickups read
 * the run account to resolve the job and node (a run is 1:1 with a pickup); if
 * the run is already closed, the pickup is still recorded against its market.
 */
export class JobEventDecoder {
  private readonly nosanaClient: NosanaClient;
  private readonly jobsProgramAddress: string;

  constructor(nosanaClient: NosanaClient) {
    this.nosanaClient = nosanaClient;
    this.jobsProgramAddress = nosanaClient.config.programs.jobsAddress.toString();
  }

  async decode(tx: unknown): Promise<DecodedEvent[]> {
    const instructions = ((tx as { transaction?: { message?: { instructions?: unknown[] } } })
      ?.transaction?.message?.instructions ?? []) as RawInstruction[];

    const events: DecodedEvent[] = [];
    for (let i = 0; i < instructions.length; i++) {
      const ix = instructions[i];
      if (ix.programId !== this.jobsProgramAddress || !ix.data) continue;

      let type: string;
      let dataBytes: Uint8Array;
      try {
        dataBytes = new Uint8Array(base58.encode(ix.data));
        type = JobsClient.identifyNosanaJobsInstruction(dataBytes);
      } catch {
        continue; // not an identifiable Nosana Jobs instruction
      }

      events.push(await this.toEvent(i, type, ix.accounts ?? [], dataBytes));
    }
    return events;
  }

  private async toEvent(
    instructionIndex: number,
    type: string,
    accounts: string[],
    dataBytes: Uint8Array,
  ): Promise<DecodedEvent> {
    const spec: EntitySpec | undefined = ENTITY_MAP[type as keyof typeof ENTITY_MAP];
    const event: DecodedEvent = {
      instructionIndex,
      type,
      jobAddress: spec?.job != null ? (accounts[spec.job] ?? null) : null,
      nodeAddress: spec?.node != null ? (accounts[spec.node] ?? null) : null,
      marketAddress: spec?.market != null ? (accounts[spec.market] ?? null) : null,
      // Recorded straight from the instruction accounts, so it survives the run
      // account being closed. Every run-bearing instruction stores it, which is
      // what lets job and node be resolved across events sharing the same run.
      runAddress: spec?.run != null ? (accounts[spec.run] ?? null) : null,
      data: this.extractData(type, dataBytes),
    };

    // Only Work and QuitAdmin identify their job solely through the run account.
    // Reading it gives immediate attribution while the run is still open; once it
    // closes, the run-address join in the processor fills the job in instead, so
    // this fetch is an optimisation rather than the only source.
    if (event.runAddress && event.jobAddress == null) {
      const run = await JobsClient.fetchMaybeRunAccount(
        this.nosanaClient.solana.rpc,
        address(event.runAddress),
      );
      if (run?.exists) {
        event.jobAddress = run.data.job.toString();
        event.nodeAddress ??= run.data.node.toString();
      } else {
        logger.debug(
          { run: event.runAddress, type },
          "Run account gone; job will be resolved from other events on this run",
        );
      }
    }

    return event;
  }

  /** Typed per-event payload; currently the Extend timeout argument. */
  private extractData(type: string, dataBytes: Uint8Array): Record<string, unknown> | null {
    if (type === "Extend") {
      try {
        const { timeout } = JobsClient.getExtendInstructionDataDecoder().decode(dataBytes);
        return { timeout: Number(timeout) };
      } catch {
        return null;
      }
    }
    return null;
  }
}

export type { Signature };
