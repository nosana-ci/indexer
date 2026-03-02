import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Elysia } from 'elysia';

vi.mock('../../../src/services/price.service', () => ({
  getNosPrice: vi.fn(),
}));

import { getNosPrice } from '../../../src/services/price.service';
import statsRouter from '../../../src/modules/stats/route';

const BASE_URL = 'http://localhost';
const PRICE_URL = `${BASE_URL}/stats/price`;
const DEFAULT_MAX_AGE_MINUTES = 15;

const testTimestamp = 1704067200;
const testDate = '2024-01-01';
const testDateTimestamp = new Date(`${testDate}T00:00:00.000Z`).getTime() / 1000;

const mockStatsService = {
  getLatestStats: vi.fn(),
  getSpendingHistory: vi.fn(),
  getNodeEarningsHistory: vi.fn(),
} as any;

function createApp() {
  return new Elysia()
    .onError(({ error, status, code }) => {
      if (code === 'VALIDATION') {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Validation failed';
        return status(400, { message });
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        'message' in error
      ) {
        const { status: errStatus, message } = error as {
          status: number;
          message: string;
        };
        return status(errStatus, { message });
      }
      return status(500, { message: 'Internal server error' });
    })
    .use(statsRouter(mockStatsService));
}

describe('Stats Routes - /stats/price', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('should return price for a given timestamp', async () => {
    const expectedPrice = 1.23;
    vi.mocked(getNosPrice).mockResolvedValue(expectedPrice);

    const res = await app.handle(
      new Request(`${PRICE_URL}?timestamp=${testTimestamp}`)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.price).toBe(expectedPrice);
    expect(getNosPrice).toHaveBeenCalledWith(testTimestamp, DEFAULT_MAX_AGE_MINUTES);
  });

  it('should return price for a given date', async () => {
    const expectedPrice = 2.50;
    vi.mocked(getNosPrice).mockResolvedValue(expectedPrice);

    const res = await app.handle(
      new Request(`${PRICE_URL}?date=${testDate}`)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.price).toBe(expectedPrice);
    expect(getNosPrice).toHaveBeenCalledWith(testDateTimestamp, DEFAULT_MAX_AGE_MINUTES);
  });

  it('should default to current time when no params provided', async () => {
    const expectedPrice = 3.00;
    vi.mocked(getNosPrice).mockResolvedValue(expectedPrice);
    const before = Math.floor(Date.now() / 1000);

    const res = await app.handle(new Request(PRICE_URL));
    const body = await res.json();

    const after = Math.floor(Date.now() / 1000);

    expect(res.status).toBe(200);
    expect(body.price).toBe(expectedPrice);

    const calledTimestamp = vi.mocked(getNosPrice).mock.calls[0][0] as number;
    expect(calledTimestamp).toBeGreaterThanOrEqual(before);
    expect(calledTimestamp).toBeLessThanOrEqual(after);
  });

  it('should pass custom maxAgeMinutes', async () => {
    const customMaxAge = 60;
    vi.mocked(getNosPrice).mockResolvedValue(1.00);

    await app.handle(
      new Request(`${PRICE_URL}?timestamp=${testTimestamp}&maxAgeMinutes=${customMaxAge}`)
    );

    expect(getNosPrice).toHaveBeenCalledWith(testTimestamp, customMaxAge);
  });

  it('should return null price when getNosPrice returns null', async () => {
    vi.mocked(getNosPrice).mockResolvedValue(null);

    const res = await app.handle(
      new Request(`${PRICE_URL}?timestamp=${testTimestamp}`)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.price).toBeNull();
  });

  it('should return 400 for invalid timestamp', async () => {
    const res = await app.handle(
      new Request(`${PRICE_URL}?timestamp=abc`)
    );

    expect(res.status).toBe(400);
    expect(getNosPrice).not.toHaveBeenCalled();
  });

  it('should return 400 for negative timestamp', async () => {
    const res = await app.handle(
      new Request(`${PRICE_URL}?timestamp=-100`)
    );

    expect(res.status).toBe(400);
    expect(getNosPrice).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid date format', async () => {
    const res = await app.handle(
      new Request(`${PRICE_URL}?date=not-a-date`)
    );

    expect(res.status).toBe(400);
    expect(getNosPrice).not.toHaveBeenCalled();
  });

  it('should prefer timestamp over date when both provided', async () => {
    const expectedPrice = 1.50;
    vi.mocked(getNosPrice).mockResolvedValue(expectedPrice);

    const res = await app.handle(
      new Request(
        `${PRICE_URL}?timestamp=${testTimestamp}&date=2025-06-01`
      )
    );

    expect(res.status).toBe(200);
    expect(getNosPrice).toHaveBeenCalledWith(testTimestamp, DEFAULT_MAX_AGE_MINUTES);
  });
});
