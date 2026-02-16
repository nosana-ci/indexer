CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" varchar(44) NOT NULL,
	"ipfs_job" varchar(256),
	"ipfs_result" varchar(256),
	"market" varchar(44) NOT NULL,
	"node" varchar(44) NOT NULL,
	"payer" varchar(44) NOT NULL,
	"price" integer NOT NULL,
	"project" varchar(44) NOT NULL,
	"state" integer NOT NULL,
	"type" varchar(256),
	"job_definition" jsonb,
	"job_result" jsonb,
	"job_status" varchar(256),
	"time_end" integer NOT NULL,
	"time_start" integer NOT NULL,
	"benchmark_processed_at" timestamp,
	"timeout" integer DEFAULT 7200 NOT NULL,
	"usd_reward_per_hour" real,
	"listed_at" integer,
	CONSTRAINT "jobs_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE INDEX "idx_jobs_state_timestart" ON "jobs" USING btree ("state","time_start" desc);