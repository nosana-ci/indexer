import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAppMode, shouldRunApi, shouldRunIndexer, shouldRunCron } from "../../../src/config/mode";

describe("getAppMode", () => {
  const originalAppMode = process.env.APP_MODE;

  beforeEach(() => {
    delete process.env.APP_MODE;
  });

  afterEach(() => {
    if (originalAppMode !== undefined) {
      process.env.APP_MODE = originalAppMode;
    } else {
      delete process.env.APP_MODE;
    }
  });

  it("returns 'all' when APP_MODE is not set", () => {
    expect(getAppMode()).toBe("all");
  });

  it.each(["all", "api", "indexer", "cron"] as const)(
    "returns '%s' when APP_MODE is set to '%s'",
    (mode) => {
      process.env.APP_MODE = mode;
      expect(getAppMode()).toBe(mode);
    },
  );

  it("throws an error for invalid value 'invalid'", () => {
    process.env.APP_MODE = "invalid";
    expect(() => getAppMode()).toThrow('Invalid APP_MODE "invalid"');
  });

  it("throws an error for uppercase 'API'", () => {
    process.env.APP_MODE = "API";
    expect(() => getAppMode()).toThrow('Invalid APP_MODE "API"');
  });

  it("throws an error for empty string", () => {
    process.env.APP_MODE = "";
    expect(() => getAppMode()).toThrow('Invalid APP_MODE ""');
  });
});

describe("shouldRunApi", () => {
  it("returns true for 'all'", () => {
    expect(shouldRunApi("all")).toBe(true);
  });

  it("returns true for 'api'", () => {
    expect(shouldRunApi("api")).toBe(true);
  });

  it("returns false for 'indexer'", () => {
    expect(shouldRunApi("indexer")).toBe(false);
  });

  it("returns false for 'cron'", () => {
    expect(shouldRunApi("cron")).toBe(false);
  });
});

describe("shouldRunIndexer", () => {
  it("returns true for 'all'", () => {
    expect(shouldRunIndexer("all")).toBe(true);
  });

  it("returns true for 'indexer'", () => {
    expect(shouldRunIndexer("indexer")).toBe(true);
  });

  it("returns false for 'api'", () => {
    expect(shouldRunIndexer("api")).toBe(false);
  });

  it("returns false for 'cron'", () => {
    expect(shouldRunIndexer("cron")).toBe(false);
  });
});

describe("shouldRunCron", () => {
  it("returns true for 'all'", () => {
    expect(shouldRunCron("all")).toBe(true);
  });

  it("returns true for 'cron'", () => {
    expect(shouldRunCron("cron")).toBe(true);
  });

  it("returns false for 'api'", () => {
    expect(shouldRunCron("api")).toBe(false);
  });

  it("returns false for 'indexer'", () => {
    expect(shouldRunCron("indexer")).toBe(false);
  });
});
