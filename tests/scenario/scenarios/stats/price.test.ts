import { expect } from 'vitest';

import { backendUrl } from '../../setup.js';
import { createFlow } from '../../utils/index.js';

createFlow('NOS price', (step) => {
  step('GET /stats/price returns current NOS price', async () => {
    const response = await fetch(`${backendUrl}/stats/price`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('price');
    expect(typeof body.price).toBe('number');
  });

  step('GET /stats/price?date=2025-01-01 returns historical price', async () => {
    const response = await fetch(`${backendUrl}/stats/price?date=2025-01-01`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('price');
  });
});
