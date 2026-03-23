import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const initEnv = () => {
  const envName = process.env.APP_ENV;

  // Load most-specific first, then base defaults.
  // Using override: false (default) so system env vars (e.g. from docker-compose) always win.
  const paths: string[] = [];
  if (envName) paths.push(resolve(process.cwd(), `.env.${envName}`));
  paths.push(resolve(process.cwd(), ".env"));

  for (const path of paths) {
    if (!existsSync(path)) continue;
    dotenvConfig({ path });
  }
};
