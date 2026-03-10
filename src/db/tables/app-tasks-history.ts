import { pgTable, serial, varchar, timestamp } from "drizzle-orm/pg-core";

export const appTasksHistory = pgTable("app_tasks_history", {
  id: serial("id").primaryKey(),
  taskId: varchar("task_id", { length: 255 }).notNull().unique(),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
});
