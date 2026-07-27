import { getDb } from "../db/client";
import {
  programEvents,
  type InsertProgramEvent,
  type SelectProgramEvent,
} from "../db/tables/program-events";
import { eq, sql } from "drizzle-orm";

export default class ProgramEventsRepository {
  private get db() {
    return getDb();
  }

  /**
   * Inserts events, ignoring any already present (same signature + instruction
   * index). Returns the number of newly inserted rows.
   */
  async insertMany(events: InsertProgramEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    const inserted = await this.db
      .insert(programEvents)
      .values(events)
      .onConflictDoNothing({
        target: [programEvents.signature, programEvents.instructionIndex],
      })
      .returning({ id: programEvents.id })
      .execute();

    return inserted.length;
  }

  /**
   * Fills in job and node addresses that were unknown at decode time, using
   * other events that reference the same run account.
   *
   * A node's `work` (or a poster's `list`) passes a run account that the program
   * fills with the job and node when there is a counterpart waiting in the
   * queue. Reading that account only works while it is open, and it closes as
   * soon as the job ends — so a pickup decoded after the fact would otherwise
   * lose its job entirely. Every run-bearing instruction records `run_address`
   * straight from its accounts, so the pairing stays recoverable: `work` carries
   * the node (it signs), and `list`/`finish`/`quit`/`end`/`claim`/`assign` all
   * carry the job.
   *
   * Idempotent and order-independent — safe to run after every decode pass.
   * Returns the number of rows filled in.
   */
  async resolveRunAttribution(): Promise<number> {
    const result = await this.db.execute(sql`
      with known as (
        select
          run_address,
          max(job_address) filter (where job_address is not null) as job_address,
          max(node_address) filter (where node_address is not null) as node_address
        from program_events
        where run_address is not null
        group by run_address
      )
      update program_events e
      set job_address = coalesce(e.job_address, k.job_address),
          node_address = coalesce(e.node_address, k.node_address)
      from known k
      where e.run_address = k.run_address
        and (
          (e.job_address is null and k.job_address is not null)
          or (e.node_address is null and k.node_address is not null)
        )
    `);
    return result.rowCount ?? 0;
  }

  /** Returns a job's event timeline, oldest first. */
  async findByJob(jobAddress: string): Promise<SelectProgramEvent[]> {
    return (
      this.db
        .select()
        .from(programEvents)
        .where(eq(programEvents.jobAddress, jobAddress))
        // Chain order, not insertion order: block_time is only second-granular so
        // events from different slots tie, and `id` reflects the order the
        // processor's concurrent decodes happened to finish in.
        .orderBy(programEvents.slot, programEvents.instructionIndex)
        .execute()
    );
  }
}
