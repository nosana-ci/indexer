import { Gauge } from "prom-client";
import type { RegistryHandle } from "./registry";
import type StatsService from "../modules/stats/service";

const STATS_REFRESH_INTERVAL_MS = 30_000;

/**
 * Registers Nosana stats gauges that refresh every 30 seconds from the DB.
 * In api mode the refresher reads only; in cron mode it reads after the cron writes.
 * The app_mode constant label (set on the registry) separates the series.
 *
 * Returns a cleanup function that clears the refresh interval.
 */
export function registerStatsGauges(
  handle: RegistryHandle,
  statsService: Pick<StatsService, "getLatestStats">,
): () => void {
  const nosStaked = new Gauge({
    name: "nosana_stats_nos_staked",
    help: "NOS tokens staked",
    registers: [handle.registry],
  });

  const xnosStaked = new Gauge({
    name: "nosana_stats_xnos_staked",
    help: "xNOS tokens staked",
    registers: [handle.registry],
  });

  const stakersCount = new Gauge({
    name: "nosana_stats_stakers_count",
    help: "Number of NOS stakers",
    registers: [handle.registry],
  });

  const nosPriceUsd = new Gauge({
    name: "nosana_stats_nos_price_usd",
    help: "NOS token price in USD",
    registers: [handle.registry],
  });

  const marketCapUsd = new Gauge({
    name: "nosana_stats_market_cap_usd",
    help: "NOS market cap in USD",
    registers: [handle.registry],
  });

  const dailyVolumeUsd = new Gauge({
    name: "nosana_stats_daily_volume_usd",
    help: "NOS daily trading volume in USD",
    registers: [handle.registry],
  });

  const totalSupply = new Gauge({
    name: "nosana_stats_total_supply",
    help: "NOS total supply",
    registers: [handle.registry],
  });

  const circulatingSupply = new Gauge({
    name: "nosana_stats_circulating_supply",
    help: "NOS circulating supply",
    registers: [handle.registry],
  });

  const dailyPriceChange = new Gauge({
    name: "nosana_stats_daily_price_change_pct",
    help: "NOS daily price change percentage",
    registers: [handle.registry],
  });

  async function refresh(): Promise<void> {
    try {
      const stats = await statsService.getLatestStats();
      if (!stats) return;

      if (stats.nosStaked != null) nosStaked.set(Number(stats.nosStaked));
      if (stats.totalXNosStaked != null) xnosStaked.set(Number(stats.totalXNosStaked));
      if (stats.stakers != null) stakersCount.set(stats.stakers);
      if (stats.price != null) nosPriceUsd.set(stats.price);
      if (stats.marketCap != null) marketCapUsd.set(stats.marketCap);
      if (stats.dailyVolume != null) dailyVolumeUsd.set(stats.dailyVolume);
      if (stats.totalSupply != null) totalSupply.set(stats.totalSupply);
      if (stats.circulatingSupply != null) circulatingSupply.set(stats.circulatingSupply);
      if (stats.dailyPriceChange != null) dailyPriceChange.set(stats.dailyPriceChange);
    } catch {
      // Swallow errors to avoid crashing the refresh loop
    }
  }

  const intervalId = setInterval(() => {
    void refresh();
  }, STATS_REFRESH_INTERVAL_MS);

  return () => clearInterval(intervalId);
}
