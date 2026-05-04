import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDatabaseUrlFromParts } from "../../../src/db/connection-string";

const HOST = "db.example.com";
const USER = "appuser";
const PASSWORD = "s3cret";
const DATABASE = "appdb";
const DEFAULT_PORT = "5432";
const CUSTOM_PORT = "6543";
const SSL_PARAMS = "sslmode=verify-full&sslrootcert=/etc/ssl/certs/rds-global-bundle.pem";

const POSTGRES_ENV_KEYS = [
  "POSTGRES_HOST",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "POSTGRES_PORT",
  "POSTGRES_ENABLE_SSL",
] as const;

function setRequired() {
  process.env.POSTGRES_HOST = HOST;
  process.env.POSTGRES_USER = USER;
  process.env.POSTGRES_PASSWORD = PASSWORD;
  process.env.POSTGRES_DB = DATABASE;
}

describe("db/connection-string :: buildDatabaseUrlFromParts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of POSTGRES_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("builds a URL with the default port and SSL enabled when only required vars are set", () => {
    setRequired();

    expect(buildDatabaseUrlFromParts()).toBe(
      `postgresql://${USER}:${PASSWORD}@${HOST}:${DEFAULT_PORT}/${DATABASE}?${SSL_PARAMS}`,
    );
  });

  it("uses POSTGRES_PORT when provided", () => {
    setRequired();
    process.env.POSTGRES_PORT = CUSTOM_PORT;

    expect(buildDatabaseUrlFromParts()).toBe(
      `postgresql://${USER}:${PASSWORD}@${HOST}:${CUSTOM_PORT}/${DATABASE}?${SSL_PARAMS}`,
    );
  });

  it.each(["true", "TRUE", "True"])(
    "enables SSL when POSTGRES_ENABLE_SSL is %s",
    (sslValue) => {
      setRequired();
      process.env.POSTGRES_ENABLE_SSL = sslValue;

      expect(buildDatabaseUrlFromParts()).toContain(`?${SSL_PARAMS}`);
    },
  );

  it.each(["false", "FALSE", "False"])(
    "disables SSL when POSTGRES_ENABLE_SSL is %s",
    (sslValue) => {
      setRequired();
      process.env.POSTGRES_ENABLE_SSL = sslValue;

      expect(buildDatabaseUrlFromParts()).toBe(
        `postgresql://${USER}:${PASSWORD}@${HOST}:${DEFAULT_PORT}/${DATABASE}`,
      );
    },
  );

  it.each(POSTGRES_ENV_KEYS.slice(0, 4))(
    "returns undefined when %s is missing",
    (missingKey) => {
      setRequired();
      delete process.env[missingKey];

      expect(buildDatabaseUrlFromParts()).toBeUndefined();
    },
  );

  it("percent-encodes special characters in user and password", () => {
    process.env.POSTGRES_HOST = HOST;
    process.env.POSTGRES_USER = "user@with:special/chars";
    process.env.POSTGRES_PASSWORD = "pass with spaces&%";
    process.env.POSTGRES_DB = DATABASE;

    expect(buildDatabaseUrlFromParts()).toBe(
      `postgresql://user%40with%3Aspecial%2Fchars:pass%20with%20spaces%26%25@${HOST}:${DEFAULT_PORT}/${DATABASE}?${SSL_PARAMS}`,
    );
  });
});
