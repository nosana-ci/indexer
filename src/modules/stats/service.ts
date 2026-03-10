import type { NosanaClient } from "@nosana/kit";
import { sql } from "drizzle-orm";
import StatsRepository from "../../repositories/stats.repository";
import parentLogger from "../../logger";
import { ValidationError } from "../../errors";
import {
  type PeriodData,
  type HistoryType,
  groupRowsIntoPeriods,
  attachDailyBreakdowns,
  aggregateCurrentMonthFromDays,
  aggregatePrevMonthFromDays,
  formatMonthPrefix,
  computeForecast,
  computeMonthComparison,
  computeSameDayComparison,
} from "./stats-transforms";

const logger = parentLogger.child({ module: "stats" });

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
      date: latestStats?.date?.toISOString() ?? "",
      usdValueStaked:
        latestStats.usdValueStaked !== null ? String(latestStats.usdValueStaked) : null,
      nosStaked: latestStats.nosStaked !== null ? String(latestStats.nosStaked) : null,
      totalXNosStaked:
        latestStats.totalXNosStaked !== null ? String(latestStats.totalXNosStaked) : null,
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
        nosStaked: stakeStats?.nosStaked ? Math.round(stakeStats.nosStaked) : null,
        totalXNosStaked: stakeStats?.xNosStaked ? Math.round(stakeStats.xNosStaked) : null,
        stakers: stakeStats ? Number(stakeStats.stakers) : null,
        price: nosStats.price ? Number(nosStats.price) : null,
        marketCap: nosStats.marketCap ? Number(nosStats.marketCap) : null,
        dailyVolume: nosStats.dailyVolume ? Number(nosStats.dailyVolume) : null,
        totalSupply: nosStats.totalSupply ? Number(nosStats.totalSupply) : null,
        fullyDilutedMarketCap: nosStats.fullyDilutedMarketCap
          ? Number(nosStats.fullyDilutedMarketCap)
          : null,
        circulatingSupply: nosStats.circulatingSupply ? Number(nosStats.circulatingSupply) : null,
        dailyPriceChange: nosStats.dailyPriceChange ? Number(nosStats.dailyPriceChange) : null,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to refresh main stats");
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
        totalXNos = totalXNos + BigInt(account.xnos);
        let lockedAmount = BigInt(account.amount);

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
            lockedAmount = BigInt(Math.floor(Number(account.amount) * percentageLocked));
          } catch (error) {
            logger.error({ err: error }, "Failed to calculate locked amount for stake account");
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
      logger.error({ err: error }, "Could not fetch stake stats");
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
      const response = await fetch("https://api.coingecko.com/api/v3/coins/nosana");
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
      logger.error({ err: error }, "Could not fetch NOS stats");
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
    groupBy?: "day" | "month";
    type: HistoryType;
  }) {
    const { address, startDate, endDate, groupBy = "month", type } = params;

    if (!address) {
      throw new ValidationError(`No ${type === "spending" ? "user" : "node"} address provided`);
    }

    const startDateStr = new Date(startDate).toISOString().split("T")[0];
    const endDateStr = (endDate ? new Date(endDate) : new Date()).toISOString().split("T")[0];

    const rows = await this.statsRepo.execute(
      this.buildAggregationQuery(type, address, startDateStr, endDateStr, groupBy),
    );
    const periods = groupRowsIntoPeriods(rows, type, groupBy);

    if (groupBy === "month") {
      const dailyRows = await this.statsRepo.execute(
        this.buildDailyDetailQuery(type, address, startDateStr, endDateStr),
      );
      attachDailyBreakdowns(periods, dailyRows, type);
    }

    const { forecast, comparison, sameDayComparison, currentMonthUsd } =
      this.computeAnalytics(periods, groupBy, type);

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

  private buildAggregationQuery(
    type: HistoryType,
    address: string,
    startDateStr: string,
    endDateStr: string,
    groupBy: "day" | "month",
  ) {
    const formatStr = groupBy === "day" ? "YYYY-MM-DD" : "YYYY-MM";
    if (type === "spending") {
      return sql`
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
    }
    return sql`
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

  private buildDailyDetailQuery(
    type: HistoryType,
    address: string,
    startDateStr: string,
    endDateStr: string,
  ) {
    if (type === "spending") {
      return sql`
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
    }
    return sql`
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

  private computeAnalytics(
    periods: Record<string, PeriodData>,
    groupBy: "day" | "month",
    type: HistoryType,
  ) {
    let forecast: number | null = null;
    let comparison: { prevMonthTotal: number; pctChange: number | null } | null = null;
    let sameDayComparison: Record<string, number> | null = null;
    let currentMonthUsd: Record<string, number> | null = null;

    const currentDate = new Date();
    const currentMonthPrefix = formatMonthPrefix(currentDate);

    const currentMonthData: PeriodData | null =
      groupBy === "day"
        ? aggregateCurrentMonthFromDays(periods, currentMonthPrefix, type)
        : (periods[currentMonthPrefix] ?? null);

    if (!currentMonthData) {
      return { forecast, comparison, sameDayComparison, currentMonthUsd };
    }

    const dayOfMonth = currentDate.getDate();
    const daysInMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0,
    ).getDate();

    forecast = computeForecast(currentMonthData.total_usd, dayOfMonth, daysInMonth);

    currentMonthUsd = {
      [type === "spending" ? "currentMonthSpent" : "currentMonthEarned"]:
        currentMonthData.total_usd,
    };

    const prevDate = new Date(currentDate);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonthPrefix = formatMonthPrefix(prevDate);

    const prevMonthData: PeriodData | null =
      groupBy === "day"
        ? aggregatePrevMonthFromDays(periods, prevMonthPrefix, type)
        : (periods[prevMonthPrefix] ?? null);

    if (prevMonthData) {
      comparison = computeMonthComparison(forecast, prevMonthData.total_usd);
      sameDayComparison = computeSameDayComparison(
        prevMonthData,
        currentMonthData.total_usd,
        dayOfMonth,
        prevDate,
        type,
      );
    }

    return { forecast, comparison, sameDayComparison, currentMonthUsd };
  }

  async getSpendingHistory(
    userAddress: string,
    startDate: string,
    endDate?: string,
    groupBy: "day" | "month" = "month",
  ) {
    const result = await this.getHistoryData({
      address: userAddress,
      startDate,
      endDate,
      groupBy,
      type: "spending",
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
    groupBy: "day" | "month" = "month",
  ) {
    const result = await this.getHistoryData({
      address: nodeAddress,
      startDate,
      endDate,
      groupBy,
      type: "earnings",
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
