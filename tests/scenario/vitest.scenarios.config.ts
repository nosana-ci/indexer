import { defineConfig } from "vitest/config";

const defaultInclude = "tests/scenario/scenarios/*.test.ts";

export default () => {
  const scenario = process.argv[5];
  const flow = process.argv[6];

  console.log(
    `Running scenario tests${scenario ? ` for scenario: ${scenario}` : ""}${flow ? ` and flow: ${flow}` : ""}`,
  );

  const include =
    scenario && scenario.length > 0
      ? [
          flow
            ? `tests/scenario/scenarios/${scenario}/${flow}.test.ts`
            : `tests/scenario/scenarios/${scenario}.test.ts`,
        ]
      : [defaultInclude];

  return defineConfig({
    test: {
      globals: true,
      environment: "node",
      include,
      exclude: ["node_modules", "dist"],
      testTimeout: 1200000,
      hookTimeout: 300000,
      reporters: ["verbose"],
      bail: 0,
      fileParallelism: false,
      sequence: {
        concurrent: false,
      },
      pool: "forks",
      expect: {
        poll: {
          timeout: 60_000,
          interval: 5_000,
        },
      },
      globalSetup: ["./tests/scenario/global-setup.ts"],
      setupFiles: ["./tests/scenario/setup.ts"],
      env: {
        BACKEND_URL: process.env.BACKEND_URL ?? "http://localhost:3003",
        CRON_URL: process.env.CRON_URL ?? "http://localhost:3005",
        SOLANA_NETWORK: process.env.SOLANA_NETWORK ?? "mainnet",
        NOSANA_NETWORK: "localnet",
        SOLANA_RPC: process.env.SOLANA_RPC ?? "http://localhost:8899",
        SOLANA_WS: process.env.SOLANA_WS ?? "ws://localhost:8900",
      },
    },
  });
};
