import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const initEnv = () => {
  const envName = process.env.APP_ENV;

  const paths = [resolve(process.cwd(), ".env")];
  if (envName) paths.push(resolve(process.cwd(), `.env.${envName}`));

  // Load `.env` first, then `.env.<APP_ENV|NODE_ENV>` (second overrides first).
  for (const path of paths) {
    if (!existsSync(path)) continue;
    dotenvConfig({ path, override: true });
  }
};
