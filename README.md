# Blockchain Indexer

A **Bun + Elysia** service that indexes [Nosana](https://nosana.com) job, market, and run accounts from Solana into PostgreSQL and exposes them via a REST API.

## What it does

- **Live indexing**: Connects to Nosana via WebSocket (`monitorDetailed`) and writes job, market, and run account updates to the database as they happen on-chain.
- **Batch sync**: Runs periodic “GPA” (get program accounts) for all jobs and markets to backfill and catch up.
- **Job processing**: Fetches IPFS job definitions and results, resolves `listedAt` from chain history, and computes USD reward per hour using NOS price.
- **Daily aggregates**: Maintains `daily_earnings` (per node/market) and `daily_job_spend` (per project/market) for completed jobs.
- **Stats**: Refreshes platform stats (staking, volume, etc.) and serves spending/earning history for projects and nodes.
- **Optional job cleaner**: When configured, can clean stuck jobs using an admin signer.

The database is managed with **Drizzle** migrations. Interactive API docs are available at **`/swagger`** (Scalar UI).

---

## API routes

Base URL is the server root (e.g. `http://localhost:3000`). All job and stats endpoints are rate-limited.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check and indexer status (running, last activity, uptime). |
| `GET` | `/swagger` | OpenAPI docs (Scalar). |

### Jobs (`/jobs`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jobs` | List jobs. Query: `limit`, `offset`, `state`, `market`, `node`, `poster`, `payer`, `timeStart`, `timeEnd`, `groupBy`, `timeSeriesInterval`, etc. |
| `GET` | `/jobs/running` | Running job count per market. |
| `GET` | `/jobs/running-nodes` | Running node addresses for a market. Query: `market` (required). |
| `GET` | `/jobs/long-running` | Jobs running longer than their timeout. Query: `market`, `payer`. |
| `GET` | `/jobs/stats` | Aggregated job statistics (grouping, time series). Query: `market`, `node`, `poster`, `payer`, `timeStart`, `timeEnd`, `groupBy`, `timeSeriesInterval`, etc. |
| `GET` | `/jobs/stats/timestamps` | Job timestamps for a period. Query: `period` (seconds). |
| `GET` | `/jobs/count` | Total job count and counts per state (QUEUED, RUNNING, COMPLETED, STOPPED). Query: `market`, `node`, `project`, `payer`. |
| `POST` | `/jobs/batch` | Get multiple jobs by address. Body: `{ "addresses": string[], "limit"?: number }` (max 100 addresses; returns subset of fields, no `jobDefinition`/`jobResult`). |
| `GET` | `/jobs/:address` | Get a single job by address (full details). |

### Stats (`/stats`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/stats` | Latest platform statistics. |
| `GET` | `/stats/price` | NOS price (USD). Query: optional `timestamp` (Unix seconds) or `date` (YYYY-MM-DD)—defaults to now; optional `maxAgeMinutes`. |
| `GET` | `/stats/spending-history` | Spending history for an address. Query: `address`, `start_date`, `end_date`, `group_by`. |
| `GET` | `/stats/earning-history` | Earning history for a node (same query shape). |

---

## Development

### Prerequisites

- **Bun**
- **Docker** (optional, for full stack)

### Environment

Environment variables are loaded in this order:

1. `.env` (if present)
2. `.env.${APP_ENV}` (overrides `.env`, where `APP_ENV` is e.g. `local`, `development`)

Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_NETWORK` | Solana cluster (`mainnet` or `devnet`) | `mainnet` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `SOLANA_RPC` | RPC endpoint | defaults for network |
| `PORT` | Server port | `3000` |

> **No env files are baked into the Docker image.** Previously `.env.prd` and `.env.dev` were
> copied into the image and tracked in git. This was removed because baking env files into images
> risks leaking secrets if credentials are ever added, couples the image to a specific environment,
> and requires rebuilding to change configuration. Instead, `SOLANA_NETWORK` defaults to `mainnet`
> in the Dockerfile and should be overridden at runtime for other environments (see
> [Deployment](#deployment) below).

For local development, the Docker Compose setup passes all variables directly. For running
outside Docker, create a `.env` file:

```bash
cp .env.development .env
```

Edit as needed — `.env` is gitignored.

### Run with Docker Compose (recommended)

Starts the indexer, Postgres, and Adminer:

```bash
docker compose -f docker/docker-compose.yml up
```

- **Indexer**: http://localhost:3003 (or `PORT` from env)
- **Adminer**: http://localhost:8084
- **Postgres**: internal

One-command restart:

```bash
./scripts/restart-docker.sh
```

### Run locally

1. Start Postgres (or use a cloud DB) and set `DATABASE_URL`.
2. Apply migrations:

   ```bash
   bun run db:migrate
   ```

3. Start the app:

   ```bash
   bun run dev
   ```

The server listens on `PORT` (default 3000). The indexer starts WebSocket monitoring on startup; cron jobs run jobs/markets GPA, job processing, and stats refresh.

By default, the application uses the `pino` logging package to produce JSON logs.
With JOSN logs we cna add structured data to each log message.
That data then gets parsed by log ingestion tools and can be used to query the logs more efficiently.
However, for development, JSON logs aren't the nicest thing to look at.
To make that better, we can use the [`pino-pretty` package](https://github.com/pinojs/pino-pretty?tab=readme-ov-file#install).
The [docker-compose.yml](docker/docker-compose.yml) file is already configured to use `pino-pretty` in development,
so if you're running with docker compose, you will already see pretty logs by default.

### Database (Drizzle)

- **Config**: `config/drizzle.config.ts`
- **Schema**: `src/db/schema.ts`
- **Migrations**: `drizzle/`

Generate a migration after schema changes:

```bash
bun run db:generate
```

Apply migrations:

```bash
bun run db:migrate
```

Open Drizzle Studio:

```bash
bun run db:studio
```

### Tests

```bash
bun run test           # run once
bun run test:watch     # watch mode
bun run test:coverage  # with coverage
```

---

## Deployment

The Docker image does not contain any environment files. All environment-specific configuration
must be injected at runtime.

### Docker

```bash
docker run -e SOLANA_NETWORK=devnet -e DATABASE_URL=... -p 3000:3000 blockchain-indexer
```

### Kubernetes

Set environment variables in the pod spec or Helm values:

```yaml
env:
  - name: SOLANA_NETWORK
    value: "devnet"
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: blockchain-indexer
        key: database-url
```

`SOLANA_NETWORK` defaults to `mainnet` in the image, so production deployments only need to set
it explicitly if targeting a different network.
