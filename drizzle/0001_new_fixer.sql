CREATE TABLE "app_tasks_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" varchar(255) NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_tasks_history_task_id_unique" UNIQUE("task_id")
);
