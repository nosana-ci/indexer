import type { NosanaClient } from '@nosana/kit';
import { sql } from 'drizzle-orm';
import StatsRepository from '../../repositories/stats.repository';

type PeriodData = {
  total_usd: number;
  breakdown: Array<{
    market: string;
    totalSpent?: number;
    totalEarnedUsd?: number;
  }>;
  daily_breakdown?: Record<string, Record<string, number>>;
};

export default class StatsService {
  private readonly nosanaClient: NosanaClient;
  private readonly statsRepo: StatsRepository;

  constructor(nosanaClient: NosanaClient) {
    this.nosanaClient = nosanaClient;
    this.statsRepo = new StatsRepository();
  }

  async getLatestStats() {
    const statsResult = await this.statsRepo.getLatestStats();

    if (!statsResult.length || !statsResult[0].date) return null;

    const latestStats = statsResult[0];
    return {
      ...latestStats,
      date: latestStats?.date?.toISOString() ?? '',
      usdValueStaked:
        latestStats.usdValueStaked !== null
          ? String(latestStats.usdValueStaked)
          : null,
      nosStaked:
        latestStats.nosStaked !== null ? String(latestStats.nosStaked) : null,
      totalXNosStaked:
        latestStats.totalXNosStaked !== null
          ? String(latestStats.totalXNosStaked)
          : null,
    };
  }

  async refreshStats() {
    try {
      let stakeStats: {
        nosStaked?: number | null;
        xNosStaked?: number | null;
        stakers?: number | null;
      } = {};

      const lastStats = await this.getLatestStats();
      stakeStats = await this.fetchStakingStats();
      const nosStats = await this.fetchNosStats();

      if (stakeStats.nosStaked === null) {
        stakeStats.nosStaked = Number(lastStats?.nosStaked);
      }
      if (stakeStats.xNosStaked === null) {
        stakeStats.xNosStaked = Number(lastStats?.totalXNosStaked);
      }
      if (stakeStats.stakers === null) {
        stakeStats.stakers = Number(lastStats?.stakers);
      }

      await this.statsRepo.insertStats({
        usdValueStaked:
          nosStats.price && stakeStats?.nosStaked
            ? Math.round(stakeStats.nosStaked * nosStats.price)
            : null,
        nosStaked: stakeStats?.nosStaked
          ? Math.round(stakeStats.nosStaked)
          : null,
        totalXNosStaked: stakeStats?.xNosStaked
          ? Math.round(stakeStats.xNosStaked)
          : null,
        stakers: stakeStats ? Number(stakeStats.stakers) : null,
        price: nosStats.price ? Number(nosStats.price) : null,
        marketCap: nosStats.marketCap ? Number(nosStats.marketCap) : null,
        dailyVolume: nosStats.dailyVolume
          ? Number(nosStats.dailyVolume)
          : null,
        totalSupply: nosStats.totalSupply
          ? Number(nosStats.totalSupply)
          : null,
        fullyDilutedMarketCap: nosStats.fullyDilutedMarketCap
          ? Number(nosStats.fullyDilutedMarketCap)
          : null,
        circulatingSupply: nosStats.circulatingSupply
          ? Number(nosStats.circulatingSupply)
          : null,
        dailyPriceChange: nosStats.dailyPriceChange
          ? Number(nosStats.dailyPriceChange)
          : null,
      });
    } catch (error) {
      console.log('Failed to refresh main stats:', error);
    }
  }

  async fetchStakingStats(): Promise<{
    stakers: number | null;
    nosStaked: number | null;
    xNosStaked: number | null;
  }> {
    try {
      const response = await this.nosanaClient.stake.all();
      let totalNos = BigInt(0);
      let totalXNos = BigInt(0);
      let skippedCount = 0;
      const currentTime = Math.floor(Date.now() / 1000);

      for (let i = 0; i < response.length; i++) {
        const stakeAccount = response[i];
        const account = stakeAccount as {
          amount: bigint;
          duration: bigint;
          timeUnstake: bigint;
          xnos: bigint;
        };
        totalXNos = totalXNos + account.xnos;
        let lockedAmount = account.amount;

        const timeUnstakeNum = Number(account.timeUnstake);
        if (timeUnstakeNum > 0) {
          const durationNum = Number(account.duration);
          const unstakeEndTime = timeUnstakeNum + durationNum;

          if (unstakeEndTime < currentTime) {
            skippedCount++;
            continue;
          }

          try {
            const percentagePassed = (currentTime - timeUnstakeNum) / durationNum;
            const percentageLocked = 1 - percentagePassed;
            lockedAmount = BigInt(
              Math.floor(Number(account.amount) * percentageLocked)
            );
          } catch (error) {
            console.error(
              `Failed to calculate locked amount for stake account:`,
              error
            );
          }
        }

        totalNos = totalNos + lockedAmount;
      }

      return {
        stakers: response.length - skippedCount,
        nosStaked: totalNos ? Number(totalNos) / 1e6 : null,
        xNosStaked: Number(totalXNos) / 1e6,
      };
    } catch (error) {
      console.error('couldnt fetch stake stats', error);
      return {
        stakers: null,
        nosStaked: null,
        xNosStaked: null,
      };
    }
  }

  async fetchNosStats() {
    let marketCap: number | undefined,
      fullyDilutedMarketCap: number | undefined,
      price: number | undefined,
      totalSupply: number | undefined,
      circulatingSupply: number | undefined,
      dailyPriceChange: number | undefined,
      dailyVolume: number | undefined;
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/coins/nosana'
      );
      const data = await response.json();
      if (data?.market_data) {
        marketCap = data.market_data.market_cap?.usd;
        fullyDilutedMarketCap = data.market_data.fully_diluted_valuation?.usd;
        totalSupply = data.market_data.total_supply;
        circulatingSupply = data.market_data.circulating_supply;
        dailyVolume = data.market_data.total_volume?.usd;
        dailyPriceChange = data.market_data.price_change_percentage_24h;
        price = data.market_data.current_price?.usd;
      }
    } catch (error) {
      console.log('cant fetch nos stats', error);
    }
    return {
      marketCap,
      price,
      fullyDilutedMarketCap,
      circulatingSupply,
      totalSupply,
      dailyPriceChange,
      dailyVolume,
    };
  }

  private async getHistoryData(params: {
    address: string;
    startDate: string;
    endDate?: string;
    groupBy?: 'day' | 'month';
    type: 'spending' | 'earnings';
  }) {
    const { address, startDate, endDate, groupBy = 'month', type } = params;

    if (!address) {
      throw new Error(
        `No ${type === 'spending' ? 'user' : 'node'} address provided.`
      );
    }

    const parsedStartDate = new Date(startDate);
    const startDateStr = parsedStartDate.toISOString().split('T')[0];
    const parsedEndDate = endDate ? new Date(endDate) : new Date();
    const endDateStr = parsedEndDate.toISOString().split('T')[0];

    const toText = (value: unknown): string =>
      typeof value === 'string' ? value : String(value ?? '');
    const toAmount = (value: unknown): number => {
      const parsed = parseFloat(toText(value));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const formatStr = groupBy === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';

    let query;
    if (type === 'spending') {
      query = sql`
        SELECT
          to_char(daily_job_spend.date, ${formatStr}) as period_key,
          daily_job_spend.market as market,
          SUM(daily_job_spend.total_spent) as total_spent
        FROM daily_job_spend
        WHERE daily_job_spend.project = ${address}
          AND daily_job_spend.date >= ${startDateStr}
          AND daily_job_spend.date <= ${endDateStr}
        GROUP BY 1,2
        ORDER BY 1 DESC,2
      `;
    } else {
      query = sql`
        SELECT
          to_char(daily_earnings.date, ${formatStr}) as period_key,
          daily_earnings.market as market,
          SUM(CAST(daily_earnings.total_earned_usd AS DECIMAL)) as amount
        FROM daily_earnings
        WHERE daily_earnings.node = ${address}
          AND daily_earnings.date >= ${startDateStr}
          AND daily_earnings.date <= ${endDateStr}
        GROUP BY 1,2
        ORDER BY 1 DESC,2
      `;
    }

    const rows = await this.statsRepo.execute(query);

    const periods: Record<string, PeriodData> = {};

    for (const row of rows) {
      const periodKey = toText(row.period_key);
      const market = toText(row.market);
      if (!periodKey || !market) continue;
      const amount =
        type === 'spending'
          ? toAmount((row as { total_spent: unknown }).total_spent)
          : toAmount((row as { amount: unknown }).amount);

      if (!periods[periodKey]) {
        periods[periodKey] = {
          total_usd: 0,
          breakdown: [],
          daily_breakdown: groupBy === 'day' ? {} : undefined,
        };
      }

      periods[periodKey].total_usd += amount;
      periods[periodKey].breakdown.push(
        type === 'spending'
          ? { market, totalSpent: amount }
          : { market, totalEarnedUsd: amount }
      );
    }

    if (groupBy === 'month') {
      let dailyQuery;
      if (type === 'spending') {
        dailyQuery = sql`
        SELECT
          to_char(daily_job_spend.date, 'YYYY-MM-DD') as day_key,
          daily_job_spend.market as market,
          SUM(daily_job_spend.total_spent) as total_spent
        FROM daily_job_spend
        WHERE daily_job_spend.project = ${address}
          AND daily_job_spend.date >= ${startDateStr}
          AND daily_job_spend.date <= ${endDateStr}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `;
      } else {
        dailyQuery = sql`
          SELECT
            to_char(daily_earnings.date, 'YYYY-MM-DD') as day_key,
            daily_earnings.market as market,
            SUM(CAST(daily_earnings.total_earned_usd AS DECIMAL)) as amount
          FROM daily_earnings
          WHERE daily_earnings.node = ${address}
            AND daily_earnings.date >= ${startDateStr}
            AND daily_earnings.date <= ${endDateStr}
          GROUP BY 1, 2
          ORDER BY 1, 2
      `;
      }

      const dailyRows = await this.statsRepo.execute(dailyQuery);

      for (const row of dailyRows) {
        const dayKey = toText(row.day_key);
        const market = toText(row.market);
        if (!dayKey || !market) continue;
        const monthKey = dayKey.substring(0, 7);
        const amount =
          type === 'spending'
            ? toAmount((row as { total_spent: unknown }).total_spent)
            : toAmount((row as { amount: unknown }).amount);

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

    let forecast: number | null = null;
    let comparison: { prevMonthTotal: number; pctChange: number | null } | null =
      null;
    let sameDayComparison: Record<string, number> | null = null;
    let currentMonthUsd: Record<string, number> | null = null;

    const currentDate = new Date();

    let currentMonthData: PeriodData | null = null;
    if (groupBy === 'day') {
      const currentMonthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      const monthData: PeriodData = {
        total_usd: 0,
        breakdown: [],
        daily_breakdown: {},
      };
      currentMonthData = monthData;

      Object.keys(periods).forEach((periodKey) => {
        if (periodKey.startsWith(currentMonthPrefix)) {
          monthData.total_usd += periods[periodKey].total_usd;
          periods[periodKey].breakdown.forEach((marketData) => {
            const existingMarket = monthData.breakdown.find(
              (b) => b.market === marketData.market
            );
            if (existingMarket) {
              if (type === 'spending') {
                existingMarket.totalSpent =
                  (existingMarket.totalSpent || 0) +
                  (marketData.totalSpent || 0);
              } else {
                existingMarket.totalEarnedUsd =
                  (existingMarket.totalEarnedUsd || 0) +
                  (marketData.totalEarnedUsd || 0);
              }
            } else {
              monthData.breakdown.push({ ...marketData });
            }
          });
        }
      });
    } else {
      const currentMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      currentMonthData = periods[currentMonthKey] ?? null;
    }

    if (currentMonthData) {
      const dayOfMonth = currentDate.getDate();
      const daysInMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
      ).getDate();

      forecast =
        dayOfMonth > 0
          ? (currentMonthData.total_usd * daysInMonth) / dayOfMonth
          : currentMonthData.total_usd;

      currentMonthUsd = {
        [type === 'spending' ? 'currentMonthSpent' : 'currentMonthEarned']:
          currentMonthData.total_usd,
      };

      const prevDate = new Date(currentDate);
      prevDate.setMonth(prevDate.getMonth() - 1);
      let prevMonthData: PeriodData | null = null;
      if (groupBy === 'day') {
        const prevMonthPrefix = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        const previousMonthData: PeriodData = {
          total_usd: 0,
          breakdown: [],
          daily_breakdown: {},
        };
        prevMonthData = previousMonthData;

        Object.keys(periods).forEach((periodKey) => {
          if (periodKey.startsWith(prevMonthPrefix)) {
            previousMonthData.total_usd += periods[periodKey].total_usd;

            if (!previousMonthData.daily_breakdown) {
              previousMonthData.daily_breakdown = {};
            }
            const dailyBreakdown = previousMonthData.daily_breakdown;
            dailyBreakdown[periodKey] = {};

            periods[periodKey].breakdown.forEach((marketData) => {
              const amount =
                type === 'spending'
                  ? (marketData.totalSpent || 0)
                  : (marketData.totalEarnedUsd || 0);
              dailyBreakdown[periodKey][marketData.market] = amount;
            });
          }
        });
      } else {
        const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        prevMonthData = periods[prevMonthKey] ?? null;
      }

      if (prevMonthData) {
        const prevTotal = prevMonthData.total_usd;
        comparison = {
          prevMonthTotal: prevTotal,
          pctChange:
            prevTotal > 0 ? ((forecast! - prevTotal) / prevTotal) * 100 : null,
        };

        if (
          prevMonthData.daily_breakdown &&
          Object.keys(prevMonthData.daily_breakdown).length > 0
        ) {
          const maxDaysInPrevMonth = new Date(
            prevDate.getFullYear(),
            prevDate.getMonth() + 1,
            0
          ).getDate();
          const sameDayInPrevMonth = Math.min(dayOfMonth, maxDaysInPrevMonth);
          let amountUpToSameDayLastMonth = 0;

          Object.entries(prevMonthData.daily_breakdown).forEach(
            ([dayKey, marketValues]) => {
              const dayOfMonthFromKey = parseInt(dayKey.slice(-2), 10);
              if (dayOfMonthFromKey <= sameDayInPrevMonth) {
                Object.values(marketValues).forEach((amount) => {
                  amountUpToSameDayLastMonth += amount;
                });
              }
            }
          );

          const pctChangeSoFar =
            amountUpToSameDayLastMonth > 0
              ? ((currentMonthData.total_usd - amountUpToSameDayLastMonth) /
                  amountUpToSameDayLastMonth) *
                100
              : null;
          sameDayComparison = {
            [type === 'spending'
              ? 'sameDayLastMonthSpent'
              : 'sameDayLastMonthEarned']: amountUpToSameDayLastMonth,
            [type === 'spending' ? 'currentMonthSpent' : 'currentMonthEarned']:
              currentMonthData.total_usd,
            ...(pctChangeSoFar !== null && { pctChangeSoFar }),
          };
        }
      }
    }

    return {
      address,
      startDate: startDateStr,
      endDate: endDateStr,
      groupBy,
      results: Object.entries(periods).map(([period, data]) => ({
        period,
        total_usd: data.total_usd,
        breakdown: data.breakdown,
        daily_breakdown: data.daily_breakdown,
      })),
      forecast,
      comparison,
      sameDayComparison,
      currentMonth: currentMonthUsd,
    };
  }

  async getSpendingHistory(
    userAddress: string,
    startDate: string,
    endDate?: string,
    groupBy: 'day' | 'month' = 'month'
  ) {
    const result = await this.getHistoryData({
      address: userAddress,
      startDate,
      endDate,
      groupBy,
      type: 'spending',
    });

    return {
      userAddress: result.address,
      startDate: result.startDate,
      endDate: result.endDate,
      groupBy: result.groupBy,
      results: result.results,
      forecast: result.forecast,
      comparison: result.comparison,
      sameDayComparison: result.sameDayComparison,
      currentMonth: result.currentMonth,
    };
  }

  async getNodeEarningsHistory(
    nodeAddress: string,
    startDate: string,
    endDate?: string,
    groupBy: 'day' | 'month' = 'month'
  ) {
    const result = await this.getHistoryData({
      address: nodeAddress,
      startDate,
      endDate,
      groupBy,
      type: 'earnings',
    });

    const totalQuery = sql`
      SELECT SUM(CAST(daily_earnings.total_earned_usd AS DECIMAL)) as total_all_time
      FROM daily_earnings
      WHERE daily_earnings.node = ${nodeAddress}
    `;
    const totalRows = await this.statsRepo.execute(totalQuery);
    const totalAllTimeValue = totalRows[0]?.total_all_time;
    const totalAllTime = Number.parseFloat(String(totalAllTimeValue ?? 0));
    const totalEarnedAllTime =
      totalRows.length > 0 && Number.isFinite(totalAllTime) ? totalAllTime : 0;

    return {
      nodeAddress: result.address,
      startDate: result.startDate,
      endDate: result.endDate,
      groupBy: result.groupBy,
      results: result.results,
      forecast: result.forecast,
      comparison: result.comparison,
      sameDayComparison: result.sameDayComparison,
      totalEarnedAllTime,
      currentMonth: result.currentMonth,
    };
  }
}
