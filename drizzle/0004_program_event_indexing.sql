CREATE TABLE "program_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"signature" varchar(128) NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" integer,
	"failed" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" integer,
	CONSTRAINT "program_transactions_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "indexer_cursors" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" varchar(128) NOT NULL,
	"updated_at" integer NOT NULL,
	CONSTRAINT "indexer_cursors_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "program_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"signature" varchar(128) NOT NULL,
	"instruction_index" integer NOT NULL,
	"type" varchar(32) NOT NULL,
	"job_address" varchar(44),
	"node_address" varchar(44),
	"market_address" varchar(44),
	"run_address" varchar(44),
	"slot" bigint,
	"block_time" integer,
	"data" jsonb
);
--> statement-breakpoint
CREATE INDEX "idx_program_tx_pending" ON "program_transactions" USING btree ("slot") WHERE "program_transactions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_program_tx_slot" ON "program_transactions" USING btree ("slot","id");--> statement-breakpoint
CREATE INDEX "idx_program_events_job" ON "program_events" USING btree ("job_address");--> statement-breakpoint
CREATE INDEX "idx_program_events_node" ON "program_events" USING btree ("node_address");--> statement-breakpoint
CREATE INDEX "idx_program_events_market" ON "program_events" USING btree ("market_address");--> statement-breakpoint
CREATE INDEX "idx_program_events_run" ON "program_events" USING btree ("run_address");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_events_signature_instruction" ON "program_events" USING btree ("signature","instruction_index");