import { expect } from 'vitest';

import { backendUrl } from '../../setup.js';
import { createFlow } from '../../utils/index.js';

createFlow('Validation errors', (step) => {
  step('GET /jobs/invalid-address returns 404', async () => {
    const response = await fetch(`${backendUrl}/jobs/invalid-address`);
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body).toHaveProperty('message');
  });

  step('GET /stats/price?date=not-a-date returns validation error', async () => {
    const response = await fetch(`${backendUrl}/stats/price?date=not-a-date`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  step('GET /jobs/running-nodes without market param returns error', async () => {
    const response = await fetch(`${backendUrl}/jobs/running-nodes`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
