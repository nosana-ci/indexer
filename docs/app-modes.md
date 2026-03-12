# Application Modes

The blockchain-indexer supports 4 running modes controlled by the `APP_MODE` environment variable.
This enables independent deployment, scaling, and fault isolation for each concern.

## Modes

### `all` (default)

Runs everything in a single process. This is the legacy behavior and the default when
`APP_MODE` is not set. Use for local development or simple deployments.

**Components**: Full API + all cron jobs + WebSocket subscription

### `api`

Serves the REST API (job listings, stats, analytics). Horizontally scalable — safe to
run multiple replicas behind a load balancer. Does not connect to Solana RPC; reads
only from the database.

**Components**: Full Elysia app with all routes, Swagger docs;
**Scaling**: Horizontal (2-3+ replicas via HPA);
**Availablity**: To be available at least 1 pod needs to be running, and ready, at all times.

### `indexer`

Monitors the Solana blockchain via WebSocket for real-time job, market, and run account
changes. Must run as a **single replica** to avoid duplicate event processing.

**Components**: WebSocket event stream, `/health` endpoint with indexer status;
**Scaling**: Single replica, `Recreate` deployment strategy;
**Availablity**: Does not need to be available at all times. No data is lost if it goes down as long
as it shuts down gracefully. Long periods of downtime will affect the timeliness of the data in the DB.

### `cron`

Runs all periodic batch jobs. Must run as a **single replica** to avoid duplicate
processing. Handles:

- `jobs-gpa` (every 5 min) — full scan of all job accounts
- `job-processing` (every 2 min) — process pending jobs (definitions, results, USD)
- `refresh-stats` (every 5 min) — update staking and NOS token statistics
- `job-cleaner` (every 6 hours) — clean old completed jobs from blockchain

**Components**: All 4 cron jobs, `/health` endpoint;
**Scaling**: Single replica, `Recreate` deployment strategy;
**Availablity**: Does not need to be available at all times. No data is lost if it goes down as long
as it shuts down gracefully. Long periods of downtime will affect have a negative effect on the application;
**Requires**: `CLEAN_ADMIN_PRIVATE_KEY` env var for job-cleaner (optional)

## Health endpoint

All modes expose `GET /health`. The response adapts per mode:

- **indexer/all**: includes `indexer` object with `isRunning`, `lastActivity`, `uptime`, etc.
  Status is `"unhealthy"` if WebSocket is not running.
- **api/cron**: returns `{ status: "healthy", mode, timestamp }`.
  Status is always `"healthy"` (liveness = process is up).

## Environment variables

| Variable                  | Required | Default   | Description                                 |
|---------------------------|----------|-----------|---------------------------------------------|
| `APP_MODE`                | no       | `all`     | One of: `all`, `api`, `indexer`, `cron`     |
| `PORT`                    | no       | `3000`    | HTTP server port                            |
| `SOLANA_RPC`              | no       | —         | Custom Solana RPC endpoint                  |
| `SOLANA_NETWORK`          | no       | `mainnet` | `mainnet` or `devnet`                       |
| `CLEAN_ADMIN_PRIVATE_KEY` | no       | —         | JSON byte array for job cleaner (cron mode) |

## Local development

```bash
# Run all 3 modes separately (docker compose)
docker compose up

# Run legacy single-process mode
docker compose --profile legacy up blockchain-indexer

# Run a specific mode directly
APP_MODE=api bun run dev
APP_MODE=indexer bun run dev
APP_MODE=cron bun run dev
```
