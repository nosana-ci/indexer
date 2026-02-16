## Blockchain Indexer

This repo is a Bun + Elysia service with a PostgreSQL database managed via Drizzle migrations.

### Environment files

We load env vars from (in this order):

- `.env`
- `.env.${APP_ENV}` (overrides `.env`)


### Prerequisites

- **Bun**
- **Docker**

### Quickstart (recommended): run everything with Docker Compose

1) Create your local env file:

```bash
cp env.local.example .env
```

2) Start the stack:

```bash
docker compose up
```

The default compose file starts:
- **blockchain indexer**: `http://localhost:3003`
- **adminer** (DB UI): `http://localhost:8084`
- **postgres**

If you want a one-command restart:

```bash
./scripts/restart-docker.sh
```

### Database & migrations (Drizzle + PostgreSQL)

- **Config**: `config/drizzle.config.ts`
- **Schema**: `src/db/schema.ts`
- **Migrations output**: `drizzle/`

Generate a migration from schema changes:

```bash
bun run db:generate
```

Apply migrations to the database:

```bash
bun run db:migrate
```

## Database & migrations (Drizzle + PostgreSQL)

- **Config**: `config/drizzle.config.ts`
- **Schema**: `src/db/schema.ts`
- **Migrations output**: `drizzle/`

```bash
bun run db:generate
bun run db:migrate
```