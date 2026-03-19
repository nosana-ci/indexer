import { expect } from 'vitest';

import { backendUrl } from '../../setup.js';
import { createFlow } from '../../utils/index.js';

createFlow('Running jobs', (step) => {
  let marketAddress: string;

  step('GET /jobs/running returns running counts per market', async () => {
    const response = await fetch(`${backendUrl}/jobs/running`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');

    const markets = Object.keys(body);
    if (markets.length > 0) {
      marketAddress = markets[0];
    }
  });

  step('GET /jobs/running-nodes?market=<address> returns node list', async () => {
    if (!marketAddress) {
      console.log('No markets with running jobs found, using a placeholder');
      const response = await fetch(`${backendUrl}/jobs/running-nodes?market=placeholder`);
      expect(response.status).toBeLessThan(500);
      return;
    }

    const response = await fetch(`${backendUrl}/jobs/running-nodes?market=${marketAddress}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toBeDefined();
  });
});
