import { Elysia, t } from "elysia";
import {
  marketResponse,
  marketsResponse,
  queuedNodesResponse,
  runningNodesResponse,
} from "./model";
import { MarketsService } from "./service";

const marketsService = new MarketsService();

// Not rate limited: host-manager polls these many times a minute from one IP.
const marketsRouter = new Elysia({ prefix: "/markets" })
  .decorate("marketsService", marketsService)
  .get(
    "/",
    async ({ marketsService }) => {
      return await marketsService.getMarkets();
    },
    {
      response: { 200: marketsResponse },
      detail: {
        summary: "List markets with live queue and running counts",
        description:
          "Current on-chain state of every market: nodes in queue, jobs in queue, nodes running a job, the queued addresses, and job pricing/timeout.",
        tags: ["Markets"],
      },
    },
  )
  .get(
    "/queued-nodes",
    async ({ marketsService }) => {
      return await marketsService.getQueuedNodes();
    },
    {
      response: { 200: queuedNodesResponse },
      detail: {
        summary: "List nodes waiting in every node-queue market",
        description:
          "One entry per queued node across all markets whose queue type is NODE_QUEUE (1), with `position` as the node's 0-based index in that market's queue. Ordered by market, then position.",
        tags: ["Markets"],
      },
    },
  )
  .get(
    "/running-nodes",
    async ({ marketsService }) => {
      return await marketsService.getRunningNodes();
    },
    {
      response: { 200: runningNodesResponse },
      detail: {
        summary: "List nodes running a job in any market",
        description: "Distinct addresses of nodes with a RUNNING job, across all markets.",
        tags: ["Markets"],
      },
    },
  )
  .get(
    "/:address",
    async ({ params: { address }, marketsService }) => {
      return await marketsService.getMarketByAddress(address);
    },
    {
      params: t.Object({ address: t.String() }),
      response: {
        200: marketResponse,
        404: t.Object({ message: t.String() }),
      },
      detail: {
        summary: "Get a market by address",
        tags: ["Markets"],
      },
    },
  );

export default marketsRouter;
