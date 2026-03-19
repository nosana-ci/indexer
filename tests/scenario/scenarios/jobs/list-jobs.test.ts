import { expect } from 'vitest';

import { backendUrl } from '../../setup.js';
import { createFlow } from '../../utils/index.js';

createFlow('List jobs', (step) => {
  step('GET /jobs returns 200 with array', async () => {
    const response = await fetch(`${backendUrl}/jobs`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.jobs)).toBe(true);
  });

  step('GET /jobs?state=RUNNING filters correctly', async () => {
    const response = await fetch(`${backendUrl}/jobs?state=RUNNING`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.jobs)).toBe(true);

    for (const job of body.jobs) {
      expect(job.state).toBe(1);
    }
  });

  step('GET /jobs?limit=5 respects limit', async () => {
    const response = await fetch(`${backendUrl}/jobs?limit=5`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.jobs.length).toBeLessThanOrEqual(5);
  });
});
