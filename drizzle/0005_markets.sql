CREATE TABLE "markets" (
	"address" varchar(44) PRIMARY KEY NOT NULL,
	"authority" varchar(44),
	"queue_type" integer NOT NULL,
	"queue" jsonb NOT NULL,
	"queue_length" integer NOT NULL,
	"job_price" bigint,
	"job_timeout" integer,
	"job_expiration" integer,
	"job_type" integer,
	"updated_at" integer NOT NULL
);
