import { getDb } from "../db/client";
import { appTasksHistory } from "../db/tables/app-tasks-history";
import { eq } from "drizzle-orm";

/** Tracks one-time tasks (e.g. the historical backfill) so they run once. */
export default class AppTasksRepository {
  private get db() {
    return getDb();
  }

  async isComplete(taskId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: appTasksHistory.taskId })
      .from(appTasksHistory)
      .where(eq(appTasksHistory.taskId, taskId))
      .limit(1)
      .execute();
    return rows.length > 0;
  }

  async markComplete(taskId: string): Promise<void> {
    await this.db
      .insert(appTasksHistory)
      .values({ taskId })
      .onConflictDoNothing({ target: appTasksHistory.taskId })
      .execute();
  }
}
