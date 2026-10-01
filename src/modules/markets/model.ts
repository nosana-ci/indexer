import { t } from "elysia";

export const marketResponse = t.Object({
  address: t.String(),
  // 0 = JOB_QUEUE (jobs waiting), 1 = NODE_QUEUE (nodes waiting).
  queueType: t.Number(),
  nodesInQueue: t.Number(),
  jobsInQueue: t.Number(),
  // Nodes currently running a job in this market (from the jobs table).
  running: t.Number(),
  // The queued addresses (nodes or jobs, per queueType).
  queue: t.Array(t.String()),
  jobPrice: t.Nullable(t.Number()),
  jobTimeout: t.Nullable(t.Number()),
  jobExpiration: t.Nullable(t.Number()),
  jobType: t.Nullable(t.Number()),
  updatedAt: t.Number(),
});

export const marketsResponse = t.Array(marketResponse);

export const queuedNodeResponse = t.Object({
  marketAddress: t.String(),
  nodeAddress: t.String(),
  // 0-based index of the node in the market's queue.
  position: t.Number(),
});

export const queuedNodesResponse = t.Array(queuedNodeResponse);

export const runningNodesResponse = t.Array(t.String());

export type MarketResponse = typeof marketResponse.static;
export type QueuedNodeResponse = typeof queuedNodeResponse.static;
