import { expect, afterAll } from "vitest";
import { Pool } from "pg";

import { withAdvisoryLock } from "../../../src/db/migrate.js";
import { createFlow } from "../utils/index.js";

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5434"),
  user: process.env.POSTGRES_USER ?? "postgres",
  password: process.env.POSTGRES_PASSWORD ?? "postgres",
  database: process.env.POSTGRES_DB ?? "nosana_indexer",
});

afterAll(async () => {
  await pool.end();
});

createFlow("Migration advisory lock", (step) => {
  step("blocks concurrent access until the lock is released", async () => {
    const callOrder: string[] = [];

    const holder = withAdvisoryLock(pool, async () => {
      callOrder.push("holder-start");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      callOrder.push("holder-end");
    });

    // Give the holder time to acquire the lock
    await new Promise((resolve) => setTimeout(resolve, 200));

    const waiter = withAdvisoryLock(pool, async () => {
      callOrder.push("waiter-start");
    });

    await Promise.all([holder, waiter]);

    expect(callOrder).toEqual(["holder-start", "holder-end", "waiter-start"]);
  });

  step("releases the lock even when the callback throws", async () => {
    const callbackError = new Error("callback failure");

    await expect(
      withAdvisoryLock(pool, async () => {
        throw callbackError;
      }),
    ).rejects.toThrow("callback failure");

    // Lock should be available immediately after the error
    let acquired = false;
    await withAdvisoryLock(pool, async () => {
      acquired = true;
    });

    expect(acquired).toBe(true);
  });

  step("allows sequential calls without deadlocking", async () => {
    let firstCompleted = false;
    let secondCompleted = false;

    await withAdvisoryLock(pool, async () => {
      firstCompleted = true;
    });

    await withAdvisoryLock(pool, async () => {
      secondCompleted = true;
    });

    expect(firstCompleted).toBe(true);
    expect(secondCompleted).toBe(true);
  });
});
