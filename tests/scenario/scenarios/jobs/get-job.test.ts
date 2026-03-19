import { expect } from 'vitest';

import { backendUrl } from '../../setup.js';
import { createFlow } from '../../utils/index.js';

createFlow('Get job by address', (step) => {
  let jobAddress: string;

  step('GET /jobs to get a known job address', async () => {
    const response = await fetch(`${backendUrl}/jobs?limit=1`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.jobs.length).toBeGreaterThan(0);
    jobAddress = body.jobs[0].address;
    expect(jobAddress).toBeDefined();
  });

  step('GET /jobs/:address returns job details', async () => {
    const response = await fetch(`${backendUrl}/jobs/${jobAddress}`);
    expect(response.status).toBe(200);

    const job = await response.json();
    expect(job.address).toBe(jobAddress);
    expect(job).toHaveProperty('market');
    expect(job).toHaveProperty('node');
    expect(job).toHaveProperty('state');
    expect(job).toHaveProperty('price');
  });

  step('GET /jobs/invalid-address returns 404', async () => {
    const response = await fetch(`${backendUrl}/jobs/invalid-address`);
    expect(response.status).toBe(404);
  });
});
