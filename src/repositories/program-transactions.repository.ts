import { getDb } from "../db/client";
import {
  programTransactions,
  PROGRAM_TX_STATUS,
  MAX_DECODE_ATTEMPTS,
  type InsertProgramTransaction,
  type SelectProgramTransaction,
} from "../db/tables/program-transactions";
import { asc, eq, inArray, sql } from "drizzle-orm";

export default class ProgramTransactionsRepository {
  private get db() {
    return getDb();
  }

  /**
   * Inserts signatures into the ingestion log, ignoring any already present.
   * Returns the number of newly inserted rows.
   */
  async insertMany(rows: InsertProgramTransaction[]): Promise<number> {
    if (rows.length === 0) return 0;

    const inserted = await this.db
      .insert(programTransactions)
      .values(rows)
      .onConflictDoNothing({ target: programTransactions.signature })
      .returning({ id: programTransactions.id })
      .execute();

    return inserted.length;
  }

  /** Oldest stored signature — the `before` cursor for the historical backfill. */
  async getOldestSignature(): Promise<string | undefined> {
    const rows = await this.db
      .select({ signature: programTransactions.signature })
      .from(programTransactions)
      .orderBy(asc(programTransactions.slot), asc(programTransactions.id))
      .limit(1)
      .execute();
    return rows[0]?.signature;
  }

  /**
   * Returns pending transactions, oldest slot first, for the processor to decode.
   */
  async claimUnprocessed(limit: number): Promise<SelectProgramTransaction[]> {
    return this.db
      .select()
      .from(programTransactions)
      .where(eq(programTransactions.status, PROGRAM_TX_STATUS.PENDING))
      .orderBy(asc(programTransactions.slot), asc(programTransactions.id))
      .limit(limit)
      .execute();
  }

  /** Count of pending (undecoded) transactions — the processor backlog. */
  async countPending(): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(programTransactions)
      .where(eq(programTransactions.status, PROGRAM_TX_STATUS.PENDING))
      .execute();
    return rows[0]?.count ?? 0;
  }

  /**
   * Records a failed decode pass for the given signatures, parking any that
   * have now exhausted MAX_DECODE_ATTEMPTS so they stop blocking the queue.
   * Returns the number parked.
   */
  async recordFailedAttempts(signatures: string[]): Promise<number> {
    if (signatures.length === 0) return 0;
    const parked = await this.db
      .update(programTransactions)
      .set({
        attempts: sql`${programTransactions.attempts} + 1`,
        status: sql`case when ${programTransactions.attempts} + 1 >= ${MAX_DECODE_ATTEMPTS}
          then ${PROGRAM_TX_STATUS.UNAVAILABLE} else ${programTransactions.status} end`,
      })
      .where(inArray(programTransactions.signature, signatures))
      .returning({ status: programTransactions.status })
      .execute();
    return parked.filter((r) => r.status === PROGRAM_TX_STATUS.UNAVAILABLE).length;
  }

  /** Marks the given signatures processed. */
  async markProcessed(signatures: string[]): Promise<void> {
    if (signatures.length === 0) return;
    await this.db
      .update(programTransactions)
      .set({
        status: PROGRAM_TX_STATUS.PROCESSED,
        processedAt: sql`extract(epoch from now())::int`,
      })
      .where(inArray(programTransactions.signature, signatures))
      .execute();
  }

  async findBySignature(signature: string): Promise<SelectProgramTransaction | undefined> {
    return this.db.query.programTransactions.findFirst({
      where: eq(programTransactions.signature, signature),
    });
  }
}
