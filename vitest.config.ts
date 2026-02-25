import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      reportsDir: './coverage',
      exclude: ['node_modules/', 'tests/', '**/*.test.ts', '**/*.d.ts'],
    },
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: process.env.CI ? { junit: './junit.xml' } : undefined,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
