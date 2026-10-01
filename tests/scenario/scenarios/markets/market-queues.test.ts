import { expect } from "vitest";
import {
  Address,
  createMarket,
  listJob,
  getScenarioClient,
  joinMarketQueue,
} from "@nosana/scenario";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

type QueuedNode = { marketAddress: string; nodeAddress: string; position: number };

async function queuedNodesFor(marketAddress: string): Promise<QueuedNode[]> {
  const response = await fetch(`${backendUrl}/markets/queued-nodes`);
  if (response.status !== 200) return [];
  const body: QueuedNode[] = await response.json();
  return body.filter((q) => q.marketAddress === marketAddress);
}

createFlow("Market queues and running nodes", (step) => {
  let marketAddress: Address;
  let nodeAddress: string;

  step("create a market and have a node join its queue", async () => {
    marketAddress = await createMarket();

    const nodeClient = await getScenarioClient({ key: "market-queue-node" });
    nodeAddress = nodeClient.wallet!.address.toString();
    await joinMarketQueue(marketAddress.toString(), undefined, nodeClient);
  });

  step("GET /markets/queued-nodes lists the node at position 0", async () => {
    await expect
      .poll(() => queuedNodesFor(marketAddress.toString()), { interval: 3_000, timeout: 60_000 })
      .toEqual([{ marketAddress: marketAddress.toString(), nodeAddress, position: 0 }]);
  });

  step("GET /markets/:address reports a node queue holding the node", async () => {
    const response = await fetch(`${backendUrl}/markets/${marketAddress}`);
    expect(response.status).toBe(200);

    const market = await response.json();
    expect(market.queueType).toBe(1); // NODE_QUEUE
    expect(market.nodesInQueue).toBe(1);
    expect(market.queue).toEqual([nodeAddress]);
  });

  step("listing a job moves the node from the queue to /markets/running-nodes", async () => {
    await listJob({ market: marketAddress });

    await expect
      .poll(
        async () => {
          const response = await fetch(`${backendUrl}/markets/running-nodes`);
          if (response.status !== 200) return [];
          return response.json();
        },
        { interval: 3_000, timeout: 60_000 },
      )
      .toContain(nodeAddress);

    await expect
      .poll(() => queuedNodesFor(marketAddress.toString()), { interval: 3_000, timeout: 60_000 })
      .toEqual([]);
  });
});
