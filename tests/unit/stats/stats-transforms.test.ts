import { describe, it, expect } from "vitest";
import {
  toText,
  toAmount,
  formatMonthPrefix,
  extractAmount,
  groupRowsIntoPeriods,
  attachDailyBreakdowns,
  aggregateCurrentMonthFromDays,
  aggregatePrevMonthFromDays,
  computeForecast,
  computeMonthComparison,
  computeSameDayComparison,
  type PeriodData,
} from "../../../src/modules/stats/stats-transforms";

const MARKET_A = "MarketA";
const MARKET_B = "MarketB";

const MONTH_JAN = "2025-01";
const MONTH_FEB = "2025-02";
const MONTH_MAR = "2025-03";

const DAY_JAN_05 = "2025-01-05";
const DAY_JAN_10 = "2025-01-10";
const DAY_JAN_15 = "2025-01-15";
const DAY_FEB_01 = "2025-02-01";
const DAY_FEB_02 = "2025-02-02";
const DAY_FEB_05 = "2025-02-05";
const DAY_FEB_10 = "2025-02-10";
const DAY_FEB_15 = "2025-02-15";
const DAY_FEB_20 = "2025-02-20";
const DAY_FEB_28 = "2025-02-28";
const DAY_MAR_01 = "2025-03-01";
const DAY_MAR_02 = "2025-03-02";

const FEB_1_2025 = new Date(2025, 1, 1);

describe("toText", () => {
  it("should return the string as-is", () => {
    expect(toText("hello")).toBe("hello");
  });

  it("should convert numbers to strings", () => {
    expect(toText(42)).toBe("42");
  });

  it("should convert null/undefined to empty string", () => {
    expect(toText(null)).toBe("");
    expect(toText(undefined)).toBe("");
  });
});

describe("toAmount", () => {
  it("should parse valid numeric strings", () => {
    expect(toAmount("123.45")).toBe(123.45);
  });

  it("should return 0 for non-numeric values", () => {
    expect(toAmount("abc")).toBe(0);
    expect(toAmount(null)).toBe(0);
    expect(toAmount(undefined)).toBe(0);
  });

  it("should handle number inputs", () => {
    expect(toAmount(99.9)).toBe(99.9);
  });

  it("should return 0 for Infinity", () => {
    expect(toAmount(Infinity)).toBe(0);
  });
});

describe("formatMonthPrefix", () => {
  it("should format single-digit months with leading zero", () => {
    expect(formatMonthPrefix(new Date(2025, 0, 15))).toBe(MONTH_JAN);
    expect(formatMonthPrefix(new Date(2025, 8, 1))).toBe("2025-09");
  });

  it("should format double-digit months", () => {
    expect(formatMonthPrefix(new Date(2025, 11, 25))).toBe("2025-12");
  });
});

describe("extractAmount", () => {
  it("should extract total_spent for spending type", () => {
    expect(extractAmount({ total_spent: "50.25" }, "spending")).toBe(50.25);
  });

  it("should extract amount for earnings type", () => {
    expect(extractAmount({ amount: "75.50" }, "earnings")).toBe(75.5);
  });

  it("should return 0 for missing fields", () => {
    expect(extractAmount({}, "spending")).toBe(0);
    expect(extractAmount({}, "earnings")).toBe(0);
  });
});

describe("groupRowsIntoPeriods", () => {
  it("should group rows by period_key for spending", () => {
    const rows = [
      { period_key: MONTH_JAN, market: MARKET_A, total_spent: "100" },
      { period_key: MONTH_JAN, market: MARKET_B, total_spent: "50" },
      { period_key: MONTH_FEB, market: MARKET_A, total_spent: "200" },
    ];

    const result = groupRowsIntoPeriods(rows, "spending", "month");

    expect(result[MONTH_JAN].total_usd).toBe(150);
    expect(result[MONTH_JAN].breakdown).toHaveLength(2);
    expect(result[MONTH_FEB].total_usd).toBe(200);
    expect(result[MONTH_FEB].breakdown).toHaveLength(1);
  });

  it("should group rows by period_key for earnings", () => {
    const rows = [
      { period_key: DAY_JAN_15, market: MARKET_A, amount: "100" },
    ];

    const result = groupRowsIntoPeriods(rows, "earnings", "day");

    expect(result[DAY_JAN_15].total_usd).toBe(100);
    expect(result[DAY_JAN_15].breakdown[0]).toEqual({
      market: MARKET_A,
      totalEarnedUsd: 100,
    });
    expect(result[DAY_JAN_15].daily_breakdown).toEqual({});
  });

  it("should skip rows with empty period_key or market", () => {
    const rows = [
      { period_key: "", market: MARKET_A, total_spent: "100" },
      { period_key: MONTH_JAN, market: "", total_spent: "50" },
    ];

    const result = groupRowsIntoPeriods(rows, "spending", "month");

    expect(Object.keys(result)).toHaveLength(0);
  });

  it("should return empty object for empty rows", () => {
    expect(groupRowsIntoPeriods([], "spending", "month")).toEqual({});
  });
});

describe("attachDailyBreakdowns", () => {
  it("should attach daily data to existing monthly periods", () => {
    const periods: Record<string, PeriodData> = {
      [MONTH_JAN]: { total_usd: 100, breakdown: [] },
    };
    const dailyRows = [
      { day_key: DAY_JAN_05, market: MARKET_A, total_spent: "60" },
      { day_key: DAY_JAN_10, market: MARKET_A, total_spent: "40" },
    ];

    attachDailyBreakdowns(periods, dailyRows, "spending");

    expect(periods[MONTH_JAN].daily_breakdown![DAY_JAN_05][MARKET_A]).toBe(60);
    expect(periods[MONTH_JAN].daily_breakdown![DAY_JAN_10][MARKET_A]).toBe(40);
  });

  it("should create month period if not existing", () => {
    const periods: Record<string, PeriodData> = {};
    const dailyRows = [
      { day_key: DAY_MAR_01, market: MARKET_A, amount: "25" },
    ];

    attachDailyBreakdowns(periods, dailyRows, "earnings");

    expect(periods[MONTH_MAR]).toBeDefined();
    expect(periods[MONTH_MAR].daily_breakdown![DAY_MAR_01][MARKET_A]).toBe(25);
  });
});

describe("aggregateCurrentMonthFromDays", () => {
  it("should aggregate daily periods into a single month summary", () => {
    const periods: Record<string, PeriodData> = {
      [DAY_MAR_01]: {
        total_usd: 50,
        breakdown: [{ market: MARKET_A, totalSpent: 50 }],
      },
      [DAY_MAR_02]: {
        total_usd: 30,
        breakdown: [{ market: MARKET_A, totalSpent: 20 }, { market: MARKET_B, totalSpent: 10 }],
      },
      [DAY_FEB_28]: {
        total_usd: 100,
        breakdown: [{ market: MARKET_A, totalSpent: 100 }],
      },
    };

    const result = aggregateCurrentMonthFromDays(periods, MONTH_MAR, "spending");

    expect(result.total_usd).toBe(80);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown.find((b) => b.market === MARKET_A)?.totalSpent).toBe(70);
    expect(result.breakdown.find((b) => b.market === MARKET_B)?.totalSpent).toBe(10);
  });

  it("should return empty data if no matching periods", () => {
    const result = aggregateCurrentMonthFromDays({}, MONTH_MAR, "spending");

    expect(result.total_usd).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });
});

describe("aggregatePrevMonthFromDays", () => {
  it("should aggregate previous month daily periods", () => {
    const periods: Record<string, PeriodData> = {
      [DAY_FEB_15]: {
        total_usd: 40,
        breakdown: [{ market: MARKET_A, totalEarnedUsd: 40 }],
      },
      [DAY_FEB_20]: {
        total_usd: 60,
        breakdown: [{ market: MARKET_A, totalEarnedUsd: 60 }],
      },
    };

    const result = aggregatePrevMonthFromDays(periods, MONTH_FEB, "earnings");

    expect(result.total_usd).toBe(100);
    expect(result.daily_breakdown![DAY_FEB_15][MARKET_A]).toBe(40);
    expect(result.daily_breakdown![DAY_FEB_20][MARKET_A]).toBe(60);
  });
});

describe("computeForecast", () => {
  it("should extrapolate based on days elapsed", () => {
    expect(computeForecast(150, 10, 30)).toBe(450);
  });

  it("should return totalUsd when dayOfMonth is 0", () => {
    expect(computeForecast(150, 0, 30)).toBe(150);
  });

  it("should handle last day of month", () => {
    expect(computeForecast(300, 30, 30)).toBe(300);
  });
});

describe("computeMonthComparison", () => {
  it("should compute percentage change", () => {
    const result = computeMonthComparison(200, 100);

    expect(result.prevMonthTotal).toBe(100);
    expect(result.pctChange).toBe(100);
  });

  it("should return null pctChange when previous total is 0", () => {
    const result = computeMonthComparison(200, 0);

    expect(result.prevMonthTotal).toBe(0);
    expect(result.pctChange).toBeNull();
  });

  it("should compute negative percentage change", () => {
    const result = computeMonthComparison(50, 100);

    expect(result.pctChange).toBe(-50);
  });
});

describe("computeSameDayComparison", () => {
  it("should return null when no daily breakdown", () => {
    const prevMonth: PeriodData = { total_usd: 100, breakdown: [] };
    const result = computeSameDayComparison(prevMonth, 50, 10, FEB_1_2025, "spending");

    expect(result).toBeNull();
  });

  it("should return null when daily breakdown is empty", () => {
    const prevMonth: PeriodData = { total_usd: 100, breakdown: [], daily_breakdown: {} };
    const result = computeSameDayComparison(prevMonth, 50, 10, FEB_1_2025, "spending");

    expect(result).toBeNull();
  });

  it("should compute same-day comparison for spending", () => {
    const prevMonth: PeriodData = {
      total_usd: 300,
      breakdown: [],
      daily_breakdown: {
        [DAY_FEB_05]: { [MARKET_A]: 50 },
        [DAY_FEB_10]: { [MARKET_A]: 70 },
        [DAY_FEB_15]: { [MARKET_A]: 80 },
      },
    };

    const result = computeSameDayComparison(prevMonth, 200, 10, FEB_1_2025, "spending");

    expect(result).not.toBeNull();
    expect(result!["sameDayLastMonthSpent"]).toBe(120);
    expect(result!["currentMonthSpent"]).toBe(200);
    expect(result!["pctChangeSoFar"]).toBeCloseTo(66.667, 2);
  });

  it("should compute same-day comparison for earnings", () => {
    const prevMonth: PeriodData = {
      total_usd: 100,
      breakdown: [],
      daily_breakdown: {
        [DAY_FEB_01]: { [MARKET_A]: 30 },
        [DAY_FEB_02]: { [MARKET_A]: 20 },
      },
    };

    const result = computeSameDayComparison(prevMonth, 100, 5, FEB_1_2025, "earnings");

    expect(result).not.toBeNull();
    expect(result!["sameDayLastMonthEarned"]).toBe(50);
    expect(result!["currentMonthEarned"]).toBe(100);
  });

  it("should handle zero previous amount", () => {
    const prevMonth: PeriodData = {
      total_usd: 0,
      breakdown: [],
      daily_breakdown: {
        [DAY_FEB_15]: { [MARKET_A]: 0 },
      },
    };

    const result = computeSameDayComparison(prevMonth, 100, 10, FEB_1_2025, "spending");

    expect(result).not.toBeNull();
    expect(result!["sameDayLastMonthSpent"]).toBe(0);
    expect(result!["pctChangeSoFar"]).toBeUndefined();
  });
});
