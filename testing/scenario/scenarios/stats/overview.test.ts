import { expect } from 'vitest';

import { backendUrl } from '../../setup.js';
import { createFlow } from '../../utils/index.js';

createFlow('Stats overview', (step) => {
  step('GET /stats returns latest aggregated stats', async () => {
    const response = await fetch(`${backendUrl}/stats`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('date');
    expect(body).toHaveProperty('price');
    expect(body).toHaveProperty('nosStaked');
    expect(body).toHaveProperty('marketCap');
  });
});
