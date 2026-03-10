import { getDb } from "../db/client";
import { stats } from "../db/tables/stats";
import { sql } from "drizzle-orm";

/**
 * Gets NOS price at a specific timestamp with caching and fallback.
 * Caches prices in the stats table to avoid excessive API calls.
 */
export async function getNosPrice(
  timestamp: number | Date,
  maxAgeMinutes: number = 15,
): Promise<number | null> {
  const targetTimestamp = typeof timestamp === "number" ? new Date(timestamp * 1000) : timestamp;
  const maxAgeMs = maxAgeMinutes * 60 * 1000;

  try {
    const cachedPrice = await getCachedNosPrice(targetTimestamp, maxAgeMs);
    if (cachedPrice !== null) {
      return cachedPrice;
    }

    const apiPrice = await fetchNosPrice(targetTimestamp);
    if (apiPrice !== null) {
      await cacheNosPrice(targetTimestamp, apiPrice);
      return apiPrice;
    }

    // Fallback: try to get the closest available cached price (within 12 hours)
    const fallbackPrice = await getCachedNosPrice(targetTimestamp, 12 * 60 * 60 * 1000);
    if (fallbackPrice !== null) {
      console.warn(`Using fallback cached price for timestamp ${targetTimestamp.toISOString()}`);
      return fallbackPrice;
    }

    console.error(`No NOS price available for timestamp ${targetTimestamp.toISOString()}`);
    return null;
  } catch (error) {
    console.error("Error getting NOS price:", error);
    return null;
  }
}

async function getCachedNosPrice(targetTimestamp: Date, maxAgeMs: number): Promise<number | null> {
  try {
    const db = getDb();
    const result = await db
      .select({
        price: stats.price,
        date: stats.date,
      })
      .from(stats)
      .where(sql`${stats.price} IS NOT NULL`)
      .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${stats.date}) - ${targetTimestamp.getTime() / 1000})`)
      .limit(1)
      .execute();

    if (result.length === 0 || !result[0].price || !result[0].date) {
      return null;
    }

    const timeDiff = Math.abs(result[0].date.getTime() - targetTimestamp.getTime());

    if (timeDiff <= maxAgeMs) {
      return result[0].price;
    }

    return null;
  } catch (error) {
    console.error("Error getting cached NOS price:", error);
    return null;
  }
}

async function fetchNosPrice(timestamp: Date): Promise<number | null> {
  try {
    const day = timestamp.getDate().toString().padStart(2, "0");
    const month = (timestamp.getMonth() + 1).toString().padStart(2, "0");
    const year = timestamp.getFullYear();
    const dateStr = `${day}-${month}-${year}`;

    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/nosana/history?date=${dateStr}`,
    );

    if (!response.ok) {
      console.error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    if (data?.market_data?.current_price?.usd) {
      return data.market_data.current_price.usd;
    }

    console.warn(`No price data available from CoinGecko for date ${dateStr}`);
    return null;
  } catch (error) {
    console.error("Error fetching NOS price from CoinGecko:", error);
    return null;
  }
}

async function cacheNosPrice(timestamp: Date, price: number): Promise<void> {
  try {
    const db = getDb();
    await db
      .insert(stats)
      .values({
        date: timestamp,
        price: price,
      })
      .execute();
  } catch (error) {
    console.error("Error caching NOS price:", error);
  }
}
