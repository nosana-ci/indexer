import { defineConfig } from 'vitest/config';

const defaultInclude = 'testing/scenario/scenarios/*.test.ts';

export default () => {
  const scenario = process.argv[5];
  const flow = process.argv[6];

  console.log(
    `Running scenario tests${scenario ? ` for scenario: ${scenario}` : ''}${flow ? ` and flow: ${flow}` : ''}`,
  );

  const include =
    scenario && scenario.length > 0
      ? [
          flow
            ? `testing/scenario/scenarios/${scenario}/${flow}.test.ts`
            : `testing/scenario/scenarios/${scenario}.test.ts`,
        ]
      : [defaultInclude];

  return defineConfig({
    test: {
      globals: true,
      environment: 'node',
      include,
      exclude: ['node_modules', 'dist'],
      testTimeout: 1200000,
      hookTimeout: 300000,
      reporters: ['verbose'],
      bail: 0,
      fileParallelism: false,
      sequence: {
        concurrent: false,
      },
      pool: 'forks',
      expect: {
        poll: {
          timeout: 60_000,
          interval: 5_000,
        },
      },
      globalSetup: ['./testing/scenario/global-setup.ts'],
      setupFiles: ['./testing/scenario/setup.ts'],
      env: {
        BACKEND_URL: process.env.BACKEND_URL ?? 'http://localhost:3003',
        SOLANA_NETWORK: process.env.SOLANA_NETWORK ?? 'mainnet',
      },
    },
  });
};
