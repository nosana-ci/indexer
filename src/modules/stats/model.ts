import { t } from 'elysia';

export const GetStatsResponse = t.Object({
  date: t.String(),
  usdValueStaked: t.Union([t.String(), t.Null()]),
  nosStaked: t.Union([t.String(), t.Null()]),
  totalXNosStaked: t.Union([t.String(), t.Null()]),
  stakers: t.Union([t.Number(), t.Null()]),
  price: t.Union([t.Number(), t.Null()]),
  marketCap: t.Union([t.Number(), t.Null()]),
  dailyVolume: t.Union([t.Number(), t.Null()]),
  totalSupply: t.Union([t.Number(), t.Null()]),
  fullyDilutedMarketCap: t.Union([t.Number(), t.Null()]),
  circulatingSupply: t.Union([t.Number(), t.Null()]),
  dailyPriceChange: t.Union([t.Number(), t.Null()]),
});

export const SpendingHistoryQuery = t.Object({
  address: t.String(),
  start_date: t.String(),
  end_date: t.Optional(t.String()),
  group_by: t.Optional(t.Union([t.Literal('day'), t.Literal('month')])),
});

export const SpendingHistoryResponse = t.Object({
  userAddress: t.String(),
  startDate: t.String(),
  endDate: t.String(),
  groupBy: t.String(),
  results: t.Array(
    t.Object({
      period: t.String(),
      total_usd: t.Number(),
      breakdown: t.Array(
        t.Object({
          market: t.String(),
          totalSpent: t.Number(),
        })
      ),
      daily_breakdown: t.Optional(
        t.Record(t.String(), t.Record(t.String(), t.Number()))
      ),
    })
  ),
  forecast: t.Union([t.Number(), t.Null()]),
  comparison: t.Union([
    t.Object({
      prevMonthTotal: t.Number(),
      pctChange: t.Union([t.Number(), t.Null()]),
    }),
    t.Null(),
  ]),
  sameDayComparison: t.Union([
    t.Object({
      sameDayLastMonthSpent: t.Number(),
      currentMonthSpent: t.Number(),
      pctChangeSoFar: t.Optional(t.Union([t.Number(), t.Null()])),
    }),
    t.Null(),
  ]),
  currentMonth: t.Union([
    t.Object({
      currentMonthSpent: t.Number(),
    }),
    t.Null(),
  ]),
});

export const EarningsHistoryResponse = t.Object({
  nodeAddress: t.String(),
  startDate: t.String(),
  endDate: t.String(),
  groupBy: t.String(),
  results: t.Array(
    t.Object({
      period: t.String(),
      total_usd: t.Number(),
      breakdown: t.Array(
        t.Object({
          market: t.String(),
          totalEarnedUsd: t.Number(),
        })
      ),
      daily_breakdown: t.Optional(
        t.Record(t.String(), t.Record(t.String(), t.Number()))
      ),
    })
  ),
  forecast: t.Union([t.Number(), t.Null()]),
  comparison: t.Union([
    t.Object({
      prevMonthTotal: t.Number(),
      pctChange: t.Union([t.Number(), t.Null()]),
    }),
    t.Null(),
  ]),
  sameDayComparison: t.Union([
    t.Object({
      sameDayLastMonthEarned: t.Optional(t.Number()),
      currentMonthEarned: t.Number(),
      pctChangeSoFar: t.Optional(t.Union([t.Number(), t.Null()])),
    }),
    t.Null(),
  ]),
  totalEarnedAllTime: t.Number(),
  currentMonth: t.Union([
    t.Object({
      currentMonthEarned: t.Number(),
    }),
    t.Null(),
  ]),
});

export const ErrorResponse = t.Object({
  name: t.String(),
  message: t.String(),
});
