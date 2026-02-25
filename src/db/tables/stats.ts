import { integer, pgTable, timestamp, real } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const stats = pgTable('stats', {
  date: timestamp('date').default(sql`CURRENT_TIMESTAMP`),
  usdValueStaked: integer('usd_value_staked'),
  nosStaked: integer('nos_staked'),
  totalXNosStaked: integer('xnos_staked'),
  stakers: integer('stakers'),
  price: real('price'),
  marketCap: integer('market_cap'),
  dailyVolume: integer('daily_volume'),
  totalSupply: integer('total_supply'),
  circulatingSupply: integer('circulating_supply'),
  fullyDilutedMarketCap: integer('fully_diluted_market_cap'),
  dailyPriceChange: real('daily_price_change'),
});
