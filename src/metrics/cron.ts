import { Counter, Histogram } from "prom-client";
import type { RegistryHandle } from "./registry";

export const CRON_RUNS_TOTAL = "cron_runs_total";
export const CRON_RUN_DURATION_SECONDS = "cron_run_duration_seconds";

export interface CronOpts {
  name: string;
  pattern: string;
  run: (...args: unknown[]) => unknown | Promise<unknown>;
  protect?: boolean;
  [k: string]: unknown;
}

export function makeCronWrapper(handle: RegistryHandle): (opts: CronOpts) => CronOpts {
  const runs = new Counter({
    name: CRON_RUNS_TOTAL,
    help: "Cron job execution count by job name and outcome",
    labelNames: ["job", "status"] as const,
    registers: [handle.registry],
  });

  const duration = new Histogram({
    name: CRON_RUN_DURATION_SECONDS,
    help: "Cron job run duration in seconds",
    labelNames: ["job"] as const,
    buckets: [0.1, 1, 5, 30, 60, 300, 600, 1800],
    registers: [handle.registry],
  });

  return function wrap(opts: CronOpts): CronOpts {
    const originalRun = opts.run;
    return {
      ...opts,
      async run(...args: unknown[]) {
        const endTimer = duration.labels(opts.name).startTimer();
        try {
          await originalRun(...args);
          runs.labels(opts.name, "success").inc();
        } catch (err) {
          runs.labels(opts.name, "error").inc();
          throw err;
        } finally {
          endTimer();
        }
      },
    };
  };
}
