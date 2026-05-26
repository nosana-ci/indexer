import { describe, it, expect } from "vitest";
import { createRegistry } from "../../../src/metrics/registry";
import { makeCronWrapper } from "../../../src/metrics/cron";
import { CRON_RUNS_TOTAL, CRON_RUN_DURATION_SECONDS } from "../../../src/metrics/cron";

describe("makeCronWrapper", () => {
  it("increments cron_runs_total with status=success after a successful run", async () => {
    const handle = createRegistry("cron");
    const wrap = makeCronWrapper(handle);

    const wrapped = wrap({
      name: "test-job",
      pattern: "* * * * *",
      run: async () => {},
    });

    await wrapped.run();

    const output = await handle.registry.metrics();
    expect(output).toContain(`${CRON_RUNS_TOTAL}{`);
    expect(output).toContain(`job="test-job"`);
    expect(output).toContain(`status="success"`);
    expect(output).toContain("} 1");
  });

  it("observes cron_run_duration_seconds after a successful run", async () => {
    const handle = createRegistry("cron");
    const wrap = makeCronWrapper(handle);

    const wrapped = wrap({
      name: "timed-job",
      pattern: "* * * * *",
      run: async () => {},
    });

    await wrapped.run();

    const output = await handle.registry.metrics();
    expect(output).toContain(`${CRON_RUN_DURATION_SECONDS}_count{`);
    expect(output).toMatch(/_count{[^}]*job="timed-job"[^}]*} 1/);
  });

  it("increments cron_runs_total with status=error and re-throws on failure", async () => {
    const handle = createRegistry("cron");
    const wrap = makeCronWrapper(handle);

    const wrapped = wrap({
      name: "failing-job",
      pattern: "* * * * *",
      run: async () => {
        throw new Error("boom");
      },
    });

    await expect(wrapped.run()).rejects.toThrow("boom");

    const output = await handle.registry.metrics();
    expect(output).toContain(`job="failing-job"`);
    expect(output).toContain(`status="error"`);
  });

  it("preserves all original CronOpts fields on the returned object", () => {
    const handle = createRegistry("cron");
    const wrap = makeCronWrapper(handle);

    const wrapped = wrap({
      name: "preserve-test",
      pattern: "0 * * * *",
      protect: true,
      run: async () => {},
    });

    expect(wrapped.name).toBe("preserve-test");
    expect(wrapped.pattern).toBe("0 * * * *");
    expect(wrapped.protect).toBe(true);
  });
});
