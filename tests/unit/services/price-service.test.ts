import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockLimit = vi.fn(() => ({ execute: mockExecute }));
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockInsertExecute = vi.fn();
const mockValues = vi.fn(() => ({ execute: mockInsertExecute }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock("../../../src/db/client", () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { getNosPrice } from "../../../src/services/price.service";

const TIMESTAMP_JAN_15 = new Date("2025-01-15T12:00:00Z");
const CACHED_PRICE = 1.25;
const API_PRICE = 1.50;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getNosPrice", () => {
  it("should return cached price when available within maxAge", async () => {
    mockExecute.mockResolvedValueOnce([
      { price: CACHED_PRICE, date: new Date("2025-01-15T11:50:00Z") },
    ]);

    const result = await getNosPrice(TIMESTAMP_JAN_15);

    expect(result).toBe(CACHED_PRICE);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should fetch from API when no cached price exists", async () => {
    mockExecute.mockResolvedValueOnce([]);

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          market_data: { current_price: { usd: API_PRICE } },
        }),
        { status: 200 },
      ),
    );

    mockInsertExecute.mockResolvedValueOnce(undefined);

    const result = await getNosPrice(TIMESTAMP_JAN_15);

    expect(result).toBe(API_PRICE);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("should use fallback cached price when API returns no data", async () => {
    // First cache lookup (15min) — miss
    mockExecute.mockResolvedValueOnce([]);

    // API returns no price data
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    // Fallback cache lookup (12h) — hit
    mockExecute.mockResolvedValueOnce([
      { price: CACHED_PRICE, date: new Date("2025-01-15T06:00:00Z") },
    ]);

    const result = await getNosPrice(TIMESTAMP_JAN_15);

    expect(result).toBe(CACHED_PRICE);
  });

  it("should return null when no price is available at all", async () => {
    mockExecute.mockResolvedValueOnce([]);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    mockExecute.mockResolvedValueOnce([]);

    const result = await getNosPrice(TIMESTAMP_JAN_15);

    expect(result).toBeNull();
  });

  it("should return null when API returns non-ok response and no fallback", async () => {
    mockExecute.mockResolvedValueOnce([]);

    mockFetch.mockResolvedValueOnce(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
    );

    mockExecute.mockResolvedValueOnce([]);

    const result = await getNosPrice(TIMESTAMP_JAN_15);

    expect(result).toBeNull();
  });

  it("should return null and not throw on database errors", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection failed"));

    const result = await getNosPrice(TIMESTAMP_JAN_15);

    expect(result).toBeNull();
  });

  it("should accept unix timestamp as number", async () => {
    const unixTimestamp = Math.floor(TIMESTAMP_JAN_15.getTime() / 1000);

    mockExecute.mockResolvedValueOnce([
      { price: CACHED_PRICE, date: new Date("2025-01-15T11:50:00Z") },
    ]);

    const result = await getNosPrice(unixTimestamp);

    expect(result).toBe(CACHED_PRICE);
  });

  it("should cache price after successful API fetch", async () => {
    mockExecute.mockResolvedValueOnce([]);

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          market_data: { current_price: { usd: API_PRICE } },
        }),
        { status: 200 },
      ),
    );

    mockInsertExecute.mockResolvedValueOnce(undefined);

    await getNosPrice(TIMESTAMP_JAN_15);

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ price: API_PRICE }),
    );
  });

  it("should return null when cache lookup returns row with null price", async () => {
    mockExecute.mockResolvedValueOnce([{ price: null, date: TIMESTAMP_JAN_15 }]);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    mockExecute.mockResolvedValueOnce([]);

    const result = await getNosPrice(TIMESTAMP_JAN_15);

    expect(result).toBeNull();
  });
});
