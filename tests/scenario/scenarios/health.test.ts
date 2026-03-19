import { expect } from 'vitest';

import { backendUrl } from '../setup.js';
import { createFlow } from '../utils/index.js';

createFlow('Health endpoint', (step) => {
  let healthResponse: Response;
  let healthBody: Record<string, unknown>;

  step('GET /health returns 200 with status healthy', async () => {
    healthResponse = await fetch(`${backendUrl}/health`);
    expect(healthResponse.status).toBe(200);

    healthBody = await healthResponse.json();
    expect(healthBody).toHaveProperty('status', 'healthy');
  });

  step('Response contains mode and timestamp', () => {
    expect(healthBody).toHaveProperty('mode');
    expect(healthBody).toHaveProperty('timestamp');
  });

  step('Response contains indexer details when running in indexer/all mode', () => {
    const mode = healthBody.mode as string;
    if (mode !== 'indexer' && mode !== 'all') {
      return; // indexer details only present in indexer/all modes
    }

    const indexer = healthBody.indexer as Record<string, unknown>;
    expect(indexer).toBeDefined();
    expect(indexer).toHaveProperty('isRunning');
    expect(indexer).toHaveProperty('uptime');
    expect(indexer).toHaveProperty('lastActivity');
    expect(indexer).toHaveProperty('startTime');
    expect(indexer).toHaveProperty('timeSinceLastActivity');
  });
});
