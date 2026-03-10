import { Elysia, t } from "elysia";
import type StatsService from "./service";
import { SpendingHistoryQuery } from "./model";
import { getNosPrice } from "../../services/price.service";

export default function statsRouter(statsService: StatsService) {
  return new Elysia({ prefix: "/stats" })
    .get(
      "/price",
      async ({ query }) => {
        let timestamp: number;
        if (query.timestamp !== undefined) {
          timestamp = Number(query.timestamp);
          if (Number.isNaN(timestamp) || timestamp <= 0) {
            throw Object.assign(new Error("Invalid 'timestamp'"), { status: 400 });
          }
        } else if (query.date !== undefined) {
          const d = new Date(query.date + "T00:00:00.000Z");
          if (Number.isNaN(d.getTime())) {
            throw Object.assign(new Error("Invalid 'date'; use YYYY-MM-DD"), {
              status: 400,
            });
          }
          timestamp = d.getTime() / 1000;
        } else {
          timestamp = Math.floor(Date.now() / 1000);
        }

        const maxAgeMinutes = query.maxAgeMinutes !== undefined ? Number(query.maxAgeMinutes) : 15;
        const price = await getNosPrice(timestamp, maxAgeMinutes);

        return { price };
      },
      {
        query: t.Object({
          timestamp: t.Optional(t.String()),
          date: t.Optional(t.String()),
          maxAgeMinutes: t.Optional(t.String()),
        }),
        response: {
          200: t.Object({
            price: t.Union([t.Number(), t.Null()]),
          }),
        },
        detail: {
          summary: "Get NOS price for a date or timestamp",
          description:
            "Returns the NOS price (USD). Defaults to current time when neither timestamp nor date is provided. Query: timestamp (Unix seconds), date (YYYY-MM-DD), or omit for now; optional maxAgeMinutes for cache tolerance.",
          tags: ["Stats"],
        },
      },
    )
    .get(
      "/",
      async () => {
        return await statsService.getLatestStats();
      },
      {
        detail: {
          tags: ["Stats"],
          description: "Get the latest statistics",
        },
      },
    )
    .get(
      "/spending-history",
      async ({ query }) => {
        return await statsService.getSpendingHistory(
          query.address,
          query.start_date,
          query.end_date ?? undefined,
          (query.group_by as "day" | "month") ?? "month",
        );
      },
      {
        query: SpendingHistoryQuery,
        detail: {
          tags: ["Stats"],
          description:
            "Flexible endpoint to retrieve spending history with custom date ranges and grouping options.",
        },
      },
    )
    .get(
      "/earning-history",
      async ({ query }) => {
        return await statsService.getNodeEarningsHistory(
          query.address,
          query.start_date,
          query.end_date ?? undefined,
          (query.group_by as "day" | "month") ?? "month",
        );
      },
      {
        query: SpendingHistoryQuery,
        detail: {
          tags: ["Stats"],
          description:
            "Flexible endpoint to retrieve earning history of node with custom date ranges and grouping options.",
        },
      },
    );
}
