export type PeriodData = {
  total_usd: number;
  breakdown: Array<{
    market: string;
    totalSpent?: number;
    totalEarnedUsd?: number;
  }>;
  daily_breakdown?: Record<string, Record<string, number>>;
};

export type HistoryType = "spending" | "earnings";

export function toText(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export function toAmount(value: unknown): number {
  const parsed = parseFloat(toText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMonthPrefix(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function extractAmount(row: Record<string, unknown>, type: HistoryType): number {
  return type === "spending" ? toAmount(row.total_spent) : toAmount(row.amount);
}

export function groupRowsIntoPeriods(
  rows: Record<string, unknown>[],
  type: HistoryType,
  groupBy: "day" | "month",
): Record<string, PeriodData> {
  const periods: Record<string, PeriodData> = {};

  for (const row of rows) {
    const periodKey = toText(row.period_key);
    const market = toText(row.market);
    if (!periodKey || !market) continue;
    const amount = extractAmount(row, type);

    if (!periods[periodKey]) {
      periods[periodKey] = {
        total_usd: 0,
        breakdown: [],
        daily_breakdown: groupBy === "day" ? {} : undefined,
      };
    }

    periods[periodKey].total_usd += amount;
    periods[periodKey].breakdown.push(
      type === "spending" ? { market, totalSpent: amount } : { market, totalEarnedUsd: amount },
    );
  }

  return periods;
}

export function attachDailyBreakdowns(
  periods: Record<string, PeriodData>,
  dailyRows: Record<string, unknown>[],
  type: HistoryType,
): void {
  for (const row of dailyRows) {
    const dayKey = toText(row.day_key);
    const market = toText(row.market);
    if (!dayKey || !market) continue;
    const monthKey = dayKey.substring(0, 7);
    const amount = extractAmount(row, type);

    if (!periods[monthKey]) {
      periods[monthKey] = {
        total_usd: 0,
        breakdown: [],
        daily_breakdown: {},
      };
    }

    if (!periods[monthKey].daily_breakdown) {
      periods[monthKey].daily_breakdown = {};
    }

    if (!periods[monthKey].daily_breakdown![dayKey]) {
      periods[monthKey].daily_breakdown![dayKey] = {};
    }

    periods[monthKey].daily_breakdown![dayKey][market] = amount;
  }
}

export function aggregateCurrentMonthFromDays(
  periods: Record<string, PeriodData>,
  currentMonthPrefix: string,
  type: HistoryType,
): PeriodData {
  const monthData: PeriodData = {
    total_usd: 0,
    breakdown: [],
    daily_breakdown: {},
  };

  for (const periodKey of Object.keys(periods)) {
    if (!periodKey.startsWith(currentMonthPrefix)) continue;

    monthData.total_usd += periods[periodKey].total_usd;
    for (const marketData of periods[periodKey].breakdown) {
      const existingMarket = monthData.breakdown.find((b) => b.market === marketData.market);
      if (existingMarket) {
        if (type === "spending") {
          existingMarket.totalSpent =
            (existingMarket.totalSpent || 0) + (marketData.totalSpent || 0);
        } else {
          existingMarket.totalEarnedUsd =
            (existingMarket.totalEarnedUsd || 0) + (marketData.totalEarnedUsd || 0);
        }
      } else {
        monthData.breakdown.push({ ...marketData });
      }
    }
  }

  return monthData;
}

export function aggregatePrevMonthFromDays(
  periods: Record<string, PeriodData>,
  prevMonthPrefix: string,
  type: HistoryType,
): PeriodData {
  const prevData: PeriodData = {
    total_usd: 0,
    breakdown: [],
    daily_breakdown: {},
  };

  for (const periodKey of Object.keys(periods)) {
    if (!periodKey.startsWith(prevMonthPrefix)) continue;

    prevData.total_usd += periods[periodKey].total_usd;

    const dailyBreakdown = prevData.daily_breakdown!;
    dailyBreakdown[periodKey] = {};

    for (const marketData of periods[periodKey].breakdown) {
      const amount =
        type === "spending" ? marketData.totalSpent || 0 : marketData.totalEarnedUsd || 0;
      dailyBreakdown[periodKey][marketData.market] = amount;
    }
  }

  return prevData;
}

export function computeForecast(totalUsd: number, dayOfMonth: number, daysInMonth: number): number {
  return dayOfMonth > 0 ? (totalUsd * daysInMonth) / dayOfMonth : totalUsd;
}

export function computeMonthComparison(
  forecast: number,
  prevTotal: number,
): { prevMonthTotal: number; pctChange: number | null } {
  return {
    prevMonthTotal: prevTotal,
    pctChange: prevTotal > 0 ? ((forecast - prevTotal) / prevTotal) * 100 : null,
  };
}

export function computeSameDayComparison(
  prevMonthData: PeriodData,
  currentMonthTotal: number,
  dayOfMonth: number,
  prevDate: Date,
  type: HistoryType,
): Record<string, number> | null {
  if (!prevMonthData.daily_breakdown || Object.keys(prevMonthData.daily_breakdown).length === 0) {
    return null;
  }

  const maxDaysInPrevMonth = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0).getDate();
  const sameDayInPrevMonth = Math.min(dayOfMonth, maxDaysInPrevMonth);
  let amountUpToSameDayLastMonth = 0;

  for (const [dayKey, marketValues] of Object.entries(prevMonthData.daily_breakdown)) {
    const dayOfMonthFromKey = parseInt(dayKey.slice(-2), 10);
    if (dayOfMonthFromKey <= sameDayInPrevMonth) {
      for (const amount of Object.values(marketValues)) {
        amountUpToSameDayLastMonth += amount;
      }
    }
  }

  const pctChangeSoFar =
    amountUpToSameDayLastMonth > 0
      ? ((currentMonthTotal - amountUpToSameDayLastMonth) / amountUpToSameDayLastMonth) * 100
      : null;

  return {
    [type === "spending" ? "sameDayLastMonthSpent" : "sameDayLastMonthEarned"]:
      amountUpToSameDayLastMonth,
    [type === "spending" ? "currentMonthSpent" : "currentMonthEarned"]: currentMonthTotal,
    ...(pctChangeSoFar !== null && { pctChangeSoFar }),
  };
}

export function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function toIntegerOrNull(value: unknown): number | null {
  const parsed = toNumberOrNull(value);
  return parsed !== null ? Math.round(parsed) : null;
}
