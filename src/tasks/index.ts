import { getDb } from "../db/client";
import { appTasksHistory } from "../db/tables/app-tasks-history";
import { eq } from "drizzle-orm";

import parentLogger from "../logger";

const logger = parentLogger.child({ module: "startup-tasks" });

/**
 * Interface for defining one-time startup tasks.
 */
export interface StartupTask {
  id: string;
  description: string;
  run: () => Promise<void>;
}

/**
 * Registry of all one-time startup tasks.
 * Add new tasks to this array.
 */
export const startupTasksRegistry: StartupTask[] = [
  // {
  //   id: 'populateEarningAndSpendingDB_001',
  //   description: 'Populate daily earnings and job spend tables from historical jobs',
  //   run: populateEarningAndSpendingDB,
  // },
];

/**
 * Runs all registered startup tasks that haven't been completed yet.
 * Each task is tracked in the app_tasks_history table so it only runs once.
 */
export async function runStartupTasks(tasks: StartupTask[] = startupTasksRegistry): Promise<void> {
  const db = getDb();
  console.log("Checking for pending one-time startup tasks...");

  for (const task of tasks) {
    try {
      const existing = await db
        .select({ id: appTasksHistory.taskId })
        .from(appTasksHistory)
        .where(eq(appTasksHistory.taskId, task.id))
        .limit(1);

      if (existing.length > 0) continue;

      console.log(`Running one-time task: ${task.description} (${task.id})...`);
      await task.run();
      await db.insert(appTasksHistory).values({ taskId: task.id });
      console.log(`Completed one-time task: ${task.description} (${task.id})`);
    } catch (error) {
      console.error(`Error processing one-time task ${task.id} (${task.description}):`, error);
      console.warn(`Skipping task ${task.id} due to error.`);
    }
  }

  console.log("Finished checking one-time startup tasks.");
}
