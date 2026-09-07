import type { SelectProgramEvent } from "../db/tables/program-events";

/** An event derived from the stored ones, so it has no row of its own. */
export type DerivedProgramEvent = Omit<SelectProgramEvent, "id">;

// Past any real instruction index, so a pickup sorts directly after its List.
const SYNTHETIC_WORK_INDEX_OFFSET = 1_000_000;

/**
 * The job's `List`, if the market matched it against an already-queued node
 * there and then (at most one — a job is listed exactly once).
 *
 * Either signal is conclusive: a node on the List, which only the decoder's
 * read of a just-created run account can have set; or another event sharing
 * the List's *own* run, which only a match produces — a queued List's run is a
 * throwaway, and the node's later `work` brings a different one. An existing
 * `Work` on that run rules it out.
 */
export function findMatchedAtListTime(
  events: SelectProgramEvent[],
): SelectProgramEvent | undefined {
  return events.find((event) => {
    if (event.type !== "List" || event.runAddress == null) return false;
    const sameRun = events.filter((e) => e !== event && e.runAddress === event.runAddress);
    if (sameRun.some((e) => e.type === "Work")) return false;
    return event.nodeAddress != null || sameRun.length > 0;
  });
}

/** The node any event on this run recorded, a run being 1:1 with a pairing. */
export function nodeOnRun(events: SelectProgramEvent[], runAddress: string | null): string | null {
  return (
    events.find((e) => e.runAddress === runAddress && e.nodeAddress != null)?.nodeAddress ?? null
  );
}

/**
 * Stands in for the `Work` an instant match never produces — the program pairs
 * job and node inside `List` itself — so `type === "Work"` marks the pickup in
 * both paths. Flagged via `data.synthetic`, and attributed to the List's
 * transaction because that is where the pickup happened.
 */
export function syntheticPickup(
  list: SelectProgramEvent,
  nodeAddress: string,
): DerivedProgramEvent {
  return {
    ...list,
    type: "Work",
    nodeAddress,
    instructionIndex: list.instructionIndex + SYNTHETIC_WORK_INDEX_OFFSET,
    data: { synthetic: true },
  };
}
