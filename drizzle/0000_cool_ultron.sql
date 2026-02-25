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
	"timeout" integer DEFAULT 7200 NOT NULL,
	"usd_reward_per_hour" real,
	"listed_at" integer,
	CONSTRAINT "jobs_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "daily_earnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"node" varchar(44) NOT NULL,
	"market" varchar(44) NOT NULL,
	"total_earned_usd" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "daily_earnings_unique" UNIQUE("date","node","market")
);
--> statement-breakpoint
CREATE TABLE "daily_job_spend" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"project" varchar(44) NOT NULL,
	"market" varchar(44) NOT NULL,
	"total_spent" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "daily_job_spend_unique" UNIQUE("date","project","market")
);
--> statement-breakpoint
CREATE TABLE "stats" (
	"date" timestamp DEFAULT CURRENT_TIMESTAMP,
	"usd_value_staked" integer,
	"nos_staked" integer,
	"xnos_staked" integer,
	"stakers" integer,
	"price" real,
	"market_cap" integer,
	"daily_volume" integer,
	"total_supply" integer,
	"circulating_supply" integer,
	"fully_diluted_market_cap" integer,
	"daily_price_change" real
);
--> statement-breakpoint
CREATE INDEX "idx_jobs_state_timestart" ON "jobs" USING btree ("state","time_start" desc);