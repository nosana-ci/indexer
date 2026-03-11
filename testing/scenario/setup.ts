import { beforeAll } from 'vitest';

export let backendUrl: string;
export const testRunId = new Date().toISOString();

beforeAll(async () => {
  backendUrl = process.env.BACKEND_URL!;
  if (!backendUrl) {
    throw new Error('BACKEND_URL environment variable not set.');
  }

  const response = await fetch(`${backendUrl}/health`);
  if (!response.ok) {
    throw new Error(
      `Backend at ${backendUrl} is not reachable. GET /health returned ${response.status}.`,
    );
  }

  console.log(`Backend reachable at ${backendUrl} (test run: ${testRunId})`);
}, 30000);
