-- Migrations run in a transaction, so these cannot be CONCURRENTLY. On a large
-- jobs table, create them CONCURRENTLY by hand before deploying; IF NOT EXISTS
-- then makes this a no-op instead of a write-blocking rebuild.
CREATE INDEX IF NOT EXISTS "idx_jobs_timestart" ON "jobs" USING btree ("time_start" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_node_timestart" ON "jobs" USING btree ("node","time_start" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_market_timestart" ON "jobs" USING btree ("market","time_start" desc);
