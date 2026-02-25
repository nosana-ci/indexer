import { Elysia } from 'elysia';
import type StatsService from './service';
import {
  SpendingHistoryQuery,
} from './model';

export const stats = (statsService: StatsService) =>
  new Elysia({ prefix: '/stats' })
    .get(
      '/',
      async () => {
        return await statsService.getLatestStats();
      },
      {
        detail: {
          tags: ['Stats'],
          description: 'Get the latest statistics',
        },
      }
    )
    .get(
      '/spending-history',
      async ({ query }) => {
        return await statsService.getSpendingHistory(
          query.address,
          query.start_date,
          query.end_date ?? undefined,
          (query.group_by as 'day' | 'month') ?? 'month'
        );
      },
      {
        query: SpendingHistoryQuery,
        detail: {
          tags: ['Stats'],
          description:
            'Flexible endpoint to retrieve spending history with custom date ranges and grouping options.',
        },
      }
    )
    .get(
      '/earning-history',
      async ({ query }) => {
        return await statsService.getNodeEarningsHistory(
          query.address,
          query.start_date,
          query.end_date ?? undefined,
          (query.group_by as 'day' | 'month') ?? 'month'
        );
      },
      {
        query: SpendingHistoryQuery,
        detail: {
          tags: ['Stats'],
          description:
            'Flexible endpoint to retrieve earning history of node with custom date ranges and grouping options.',
        },
      }
    );
