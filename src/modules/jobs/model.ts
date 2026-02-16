import { t } from 'elysia';

export const getByAddressParams = t.Object({
  address: t.String(),
});

export const jobResponse = t.Object({
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
  jobDefinition: t.Nullable(t.Any()),
  jobResult: t.Nullable(t.Any()),
  jobStatus: t.Nullable(t.String()),
  timeEnd: t.Number(),
  timeStart: t.Number(),
  benchmarkProcessedAt: t.Nullable(t.String()),
  timeout: t.Number(),
  usdRewardPerHour: t.Nullable(t.Number()),
  listedAt: t.Nullable(t.Number()),
});

export type GetJobByIdParams = typeof getByAddressParams.static;
export type JobResponse = typeof jobResponse.static;
