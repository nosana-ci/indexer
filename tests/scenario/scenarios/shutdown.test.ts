import { expect } from 'vitest';
import { execSync } from 'child_process';

import { createFlow } from '../utils/index.js';

const DOCKER_COMPOSE_DIR = `${process.cwd()}/docker`;
const CRON_SERVICE = 'cron';
const CRON_URL = process.env.CRON_URL ?? 'http://localhost:3005';

function dc(cmd: string): string {
  return execSync(`docker compose ${cmd}`, {
    cwd: DOCKER_COMPOSE_DIR,
    encoding: 'utf-8',
    timeout: 60_000,
  }).trim();
}

createFlow('Graceful shutdown', (step) => {
  step('Cron service is healthy before shutdown', async () => {
    const response = await fetch(`${CRON_URL}/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('status', 'healthy');
    expect(body).toHaveProperty('mode', 'cron');
  });

  step('SIGTERM triggers graceful shutdown with cron cleanup', async () => {
    // Send SIGTERM to PID 1 (bun) inside the container.
    dc(`exec -T ${CRON_SERVICE} kill -TERM 1`);

    // Wait for bun to shut down, which causes the container to stop
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Verify graceful shutdown via container logs
    const logs = dc(`logs ${CRON_SERVICE} --tail=30`);
    expect(logs).toContain('Shutting down gracefully');
    expect(logs).toContain('Stopped cron scheduling');
    expect(logs).toContain('Shutdown complete');
  });

  step('Cron service restarts successfully after shutdown', async () => {
    dc(`up -d ${CRON_SERVICE}`);

    // Poll until the service is healthy again
    const maxRetries = 15;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const response = await fetch(`${CRON_URL}/health`);
        if (response.ok) {
          const body = (await response.json()) as Record<string, unknown>;
          expect(body).toHaveProperty('status', 'healthy');
          return;
        }
      } catch {
        // Container still starting up
      }
    }
    throw new Error('Cron service did not become healthy after restart');
  });
});
