CREATE TABLE "job_stats_hourly" (
	"hour" timestamp with time zone PRIMARY KEY NOT NULL,
	"jobs_started" integer NOT NULL,
	"compute_seconds" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Migrations run in a transaction at pod startup, so this cannot be
-- CONCURRENTLY. On a large jobs table, create it CONCURRENTLY by hand before
-- deploying; IF NOT EXISTS then makes this a no-op instead of a write-blocking
-- build that outlasts the liveness probe.
CREATE INDEX IF NOT EXISTS "idx_jobs_completed_timeend" ON "jobs" USING btree ("time_end") WHERE "jobs"."state" = 2;
