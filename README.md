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

Env is loaded in this order:

1. `.env`
2. `.env.${APP_ENV}` (overrides `.env`)

Create a local env file:

```bash
cp env.local.example .env
```

Configure at least:

- `DATABASE_URL` – PostgreSQL connection string
- `SOLANA_RPC` – RPC endpoint (optional; defaults for network)
- `SOLANA_NETWORK` – e.g. `mainnet` or `devnet`
- `PORT` – server port (default `3000`)

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
