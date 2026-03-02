import { t } from 'elysia';

export const getByAddressParams = t.Object({
  address: t.String(),
});

export const jobBatchItemResponse = t.Object({
  id: t.Number(),
  address: t.String(),
  ipfsJob: t.Nullable(t.String()),
  ipfsResult: t.Nullable(t.String()),
  market: t.String(),
  node: t.String(),
  payer: t.String(),
  price: t.Number(),
  project: t.String(),
  state: t.Number(),
  type: t.Nullable(t.String()),
  jobStatus: t.Nullable(t.String()),
  timeEnd: t.Number(),
  timeStart: t.Number(),
  timeout: t.Number(),
  usdRewardPerHour: t.Nullable(t.Number()),
  listedAt: t.Nullable(t.Number()),
});

export const jobResponse = t.Intersect([
  jobBatchItemResponse,
  t.Object({
    jobDefinition: t.Nullable(t.Any()),
    jobResult: t.Nullable(t.Any()),
  }),
]);

export type GetJobByIdParams = typeof getByAddressParams.static;
export type JobResponse = typeof jobResponse.static;
export type JobBatchItemResponse = typeof jobBatchItemResponse.static;

export enum JobState {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  STOPPED = 'STOPPED',
}

export const jobStateMappingReverse: Record<string, number> = {
  QUEUED: 0,
  RUNNING: 1,
  COMPLETED: 2,
  STOPPED: 3,
};

export enum GroupBy {
  Project = 'project',
  Market = 'market',
}

export enum TimeSeriesInterval {
  Day = 'day',
  Week = 'week',
  Month = 'month',
}

export type BaseAggregates = {
  completed: number;
  duration: number;
  price: number;
  usdReward: number | null;
};

export type StatsSeriesBucket = BaseAggregates & {
  time: string;
  projects?: Array<
    BaseAggregates & {
      project: string;
    }
  >;
  markets?: Array<
    BaseAggregates & {
      market: string;
      name: string | null;
    }
  >;
};

export type StatsTotals = {
  completed: number;
  duration: string;
  price: string;
  usdReward: string;
  retrieved: number;
};

export type StatsByProject = {
  retrieved: number;
  completed: number;
  duration: number;
  price: number;
  usdReward: number | null;
  projects: Array<
    BaseAggregates & {
      project: string;
    }
  >;
};

export type StatsByMarket = {
  retrieved: number;
  completed: number;
  duration: number;
  price: number;
  usdReward: number | null;
  markets: Array<
    BaseAggregates & {
      market: string;
      name: string | null;
    }
  >;
};

export type StatsTimeSeries = {
  retrieved: number;
  series: StatsSeriesBucket[];
};

export type StatsType =
  | StatsTotals
  | StatsByProject
  | StatsByMarket
  | StatsTimeSeries;

export const GetJobsQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  offset: t.Optional(t.Numeric({ minimum: 0 })),
  state: t.Optional(
    t.Union([
      t.Literal(JobState.QUEUED),
      t.Literal(JobState.RUNNING),
      t.Literal(JobState.COMPLETED),
      t.Literal(JobState.STOPPED),
    ])
  ),
  market: t.Optional(t.String()),
  node: t.Optional(t.String()),
  poster: t.Optional(t.String()),
  payer: t.Optional(t.String()),
  timeStart: t.Optional(t.Numeric({ minimum: 0 })),
  timeEnd: t.Optional(t.Numeric({ minimum: 0 })),
  groupBy: t.Optional(
    t.Union([t.Literal(GroupBy.Project), t.Literal(GroupBy.Market)])
  ),
  timeSeriesInterval: t.Optional(
    t.Union([
      t.Literal(TimeSeriesInterval.Day),
      t.Literal(TimeSeriesInterval.Week),
      t.Literal(TimeSeriesInterval.Month),
    ])
  ),
  useMultiplier: t.Optional(t.Union([t.Boolean(), t.String()])),
  skipCache: t.Optional(t.Union([t.Boolean(), t.String()])),
});

export const GetLongRunningJobsQuery = t.Object({
  market: t.Optional(t.String()),
  payer: t.Optional(t.String()),
});

export const GetJobsCountQuery = t.Object({
  market: t.Optional(t.String()),
  node: t.Optional(t.String()),
  project: t.Optional(t.String()),
  payer: t.Optional(t.String()),
});

export const JobsCountResponse = t.Object({
  total: t.Number(),
  byState: t.Object({
    QUEUED: t.Number(),
    RUNNING: t.Number(),
    COMPLETED: t.Number(),
    STOPPED: t.Number(),
  }),
});
