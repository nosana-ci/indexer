export type AppMode = "all" | "api" | "indexer" | "cron";

const VALID_MODES: ReadonlySet<string> = new Set<AppMode>(["all", "api", "indexer", "cron"]);

export function getAppMode(): AppMode {
  const raw = process.env.APP_MODE ?? "all";

  if (!VALID_MODES.has(raw)) {
    throw new Error(`Invalid APP_MODE "${raw}". Must be one of: ${[...VALID_MODES].join(", ")}`);
  }

  return raw as AppMode;
}

export function shouldRunApi(mode: AppMode): boolean {
  return mode === "all" || mode === "api";
}

export function shouldRunIndexer(mode: AppMode): boolean {
  return mode === "all" || mode === "indexer";
}

export function shouldRunCron(mode: AppMode): boolean {
  return mode === "all" || mode === "cron";
}
