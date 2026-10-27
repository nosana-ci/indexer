import { expect } from "vitest";
import { Address, createMarket, getScenarioClient } from "@nosana/scenario";

import { backendUrl } from "../../setup.js";
import { createFlow } from "../../utils/index.js";

type MarketSettings = { settingsAddress: string | null; projectAccessKey: string | null };

async function settingsFor(marketAddress: string): Promise<MarketSettings | undefined> {
  const response = await fetch(`${backendUrl}/markets/${marketAddress}`);
  if (response.status !== 200) return undefined;
  const { settingsAddress, projectAccessKey }: MarketSettings = await response.json();
  return { settingsAddress, projectAccessKey };
}

const openMarket: MarketSettings = { settingsAddress: null, projectAccessKey: null };

// Setting or closing a market's settings also writes the market account (it
// flips the restricted flag), so the indexer sees each change as a market event.
createFlow("Market settings", (step) => {
  let marketAddress: Address;
  let projectAccessKey: Address;

  step("create a market, which is open to all projects", async () => {
    marketAddress = await createMarket();

    await expect
      .poll(() => settingsFor(marketAddress.toString()), { interval: 3_000, timeout: 60_000 })
      .toEqual(openMarket);
  });

  step("restricting the market with a project access key shows up on the market", async () => {
    const client = await getScenarioClient();
    // Any existing account stands in for the NFT collection here: the indexer only mirrors it.
    const holder = await getScenarioClient({ key: "market-settings-holder" });
    projectAccessKey = holder.wallet!.address;

    const instruction = await client.jobs.setMarketSettings({
      market: marketAddress,
      projectAccessKey,
    });
    await client.solana.buildSignAndSend(instruction);
    const onChain = await client.jobs.marketSettings(marketAddress);

    await expect
      .poll(() => settingsFor(marketAddress.toString()), { interval: 3_000, timeout: 60_000 })
      .toEqual({
        settingsAddress: onChain!.address.toString(),
        projectAccessKey: projectAccessKey.toString(),
      });
  });

  step("closing the settings opens the market again", async () => {
    const client = await getScenarioClient();

    const instruction = await client.jobs.closeMarketSettings({ market: marketAddress });
    await client.solana.buildSignAndSend(instruction);

    await expect
      .poll(() => settingsFor(marketAddress.toString()), { interval: 3_000, timeout: 60_000 })
      .toEqual(openMarket);
  });
});
