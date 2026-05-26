import { createRegistry } from "./registry";
import { httpElysiaPlugin } from "./http-elysia";
import { metricsRoute } from "./route";
import { makeCronWrapper } from "./cron";
import { makeIndexerMetrics } from "./indexer";
import { registerStatsGauges } from "./gauges";
import { shouldRunApi, shouldRunCron, shouldRunIndexer } from "../config/mode";
import type { AppMode } from "../config/mode";
import type StatsService from "../modules/stats/service";

export { METRICS_ROUTE } from "./route";

/**
 * Factory that builds the metrics bundle for the given app mode.
 * Returns registry, route plugin, and optional http/cron/indexer sub-bundles
 * based on which subsystems are active in this mode.
 */
export function createMetrics(
  mode: AppMode,
  statsService?: Pick<StatsService, "getLatestStats"> | null,
) {
  const handle = createRegistry(mode);

  const result: {
    registry: ReturnType<typeof createRegistry>["registry"];
    mountRoute: ReturnType<typeof metricsRoute>;
    http?: { plugin: ReturnType<typeof httpElysiaPlugin> };
    cron?: { wrap: ReturnType<typeof makeCronWrapper> };
    indexer?: ReturnType<typeof makeIndexerMetrics>;
    cleanupGauges?: () => void;
  } = {
    registry: handle.registry,
    mountRoute: metricsRoute(handle),
  };

  if (shouldRunApi(mode)) {
    result.http = { plugin: httpElysiaPlugin(handle) };
  }

  if (shouldRunCron(mode)) {
    result.cron = { wrap: makeCronWrapper(handle) };
  }

  if (shouldRunIndexer(mode)) {
    result.indexer = makeIndexerMetrics(handle);
  }

  if ((shouldRunApi(mode) || shouldRunCron(mode)) && statsService) {
    result.cleanupGauges = registerStatsGauges(handle, statsService);
  }

  return result;
}
