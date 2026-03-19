import { expect } from 'vitest';

import { backendUrl } from '../../setup.js';
import { createFlow } from '../../utils/index.js';

createFlow('Job statistics', (step) => {
  step('GET /jobs/stats returns aggregated statistics', async () => {
    const response = await fetch(`${backendUrl}/jobs/stats`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toBeDefined();
  });

  step('GET /jobs/count returns counts per state', async () => {
    const response = await fetch(`${backendUrl}/jobs/count`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('byState');
    expect(body.byState).toHaveProperty('QUEUED');
    expect(body.byState).toHaveProperty('RUNNING');
    expect(body.byState).toHaveProperty('COMPLETED');
    expect(body.byState).toHaveProperty('STOPPED');
  });

  step('GET /jobs/stats/timestamps returns timestamp data', async () => {
    const response = await fetch(`${backendUrl}/jobs/stats/timestamps`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.data)).toBe(true);
  });
});
