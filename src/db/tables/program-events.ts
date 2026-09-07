import {
  bigint,
  integer,
  jsonb,
  pgTable,
  serial,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { MAX_PUBKEY_LENGTH } from "../constants";

const MAX_SIGNATURE_LENGTH = 128;

/**
 * One row per decoded Nosana Jobs program instruction — the queryable event log
 * for the whole program, not just jobs. Each event carries the instruction
 * `type` and whichever of job / node / market it references, so the explorer can
 * answer per-job, per-node and per-market questions (timelines, cumulative
 * counts like "nodes that joined a market") with plain GROUP BY / filters.
 *
 * Job lifecycle events (List, Delist, Work, Extend, End, Finish, Complete) have
 * `job_address` set; node-queue events (Stop) and market events (Open, Close,
 * Update) set node/market instead. `data` holds typed per-event fields
 * (e.g. the new timeout for Extend).
 *
 * Strictly on-chain instructions: a job matched at list time has no `Work` to
 * record, and the pickup standing in for it is derived when a timeline is
 * served — see JobsService.getEventsByAddress.
 */
export const programEvents = pgTable(
  "program_events",
  {
    id: serial("id").primaryKey(),
    signature: varchar("signature", { length: MAX_SIGNATURE_LENGTH }).notNull(),
    // Position within the transaction; part of the identity so multiple
    // instructions in one tx are all recorded.
    instructionIndex: integer("instruction_index").notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    jobAddress: varchar("job_address", { length: MAX_PUBKEY_LENGTH }),
    nodeAddress: varchar("node_address", { length: MAX_PUBKEY_LENGTH }),
    marketAddress: varchar("market_address", { length: MAX_PUBKEY_LENGTH }),
    // The run account the instruction passed, taken from the instruction
    // accounts rather than by reading the account, so it survives the run being
    // closed. A run is 1:1 with a job/node pairing, so events that share one can
    // fill in each other's job and node — see resolveRunAttribution().
    runAddress: varchar("run_address", { length: MAX_PUBKEY_LENGTH }),
    slot: bigint("slot", { mode: "number" }),
    blockTime: integer("block_time"),
    data: jsonb("data"),
  },
  (table) => ({
    jobAddressIdx: index("idx_program_events_job").on(table.jobAddress),
    nodeAddressIdx: index("idx_program_events_node").on(table.nodeAddress),
    marketAddressIdx: index("idx_program_events_market").on(table.marketAddress),
    runAddressIdx: index("idx_program_events_run").on(table.runAddress),
    // Idempotent ingestion: one instruction of one tx maps to one event.
    signatureInstructionIdx: uniqueIndex("uq_program_events_signature_instruction").on(
      table.signature,
      table.instructionIndex,
    ),
  }),
);

export type InsertProgramEvent = typeof programEvents.$inferInsert;
export type SelectProgramEvent = typeof programEvents.$inferSelect;
