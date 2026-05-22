import { describe, it, expect } from "vitest";
import { extractRoutePattern, statusRange } from "../../../src/metrics/labels";

describe("extractRoutePattern", () => {
  it("replaces numeric IDs with :id placeholder", () => {
    expect(extractRoutePattern("/jobs/12345")).toBe("/jobs/:id");
  });

  it("replaces Solana pubkey-length segments with :address placeholder", () => {
    const address = "9HXtaEzaE4bA12345678901234567890123456789012";
    expect(extractRoutePattern(`/nodes/${address}`)).toBe("/nodes/:address");
  });

  it("replaces 64-char alphanumeric tokens with :invitation-token placeholder", () => {
    const token = "a".repeat(64);
    expect(extractRoutePattern(`/invitations/${token}`)).toBe("/invitations/:invitation-token");
  });

  it("strips trailing slash from paths longer than root", () => {
    expect(extractRoutePattern("/jobs/")).toBe("/jobs");
  });

  it("keeps root path unchanged", () => {
    expect(extractRoutePattern("/")).toBe("/");
  });

  it("strips query string before pattern extraction", () => {
    expect(extractRoutePattern("/jobs/12345?page=1")).toBe("/jobs/:id");
  });

  it("handles multi-segment paths with mixed static and dynamic segments", () => {
    expect(extractRoutePattern("/api/v1/jobs/12345")).toBe("/api/v1/jobs/:id");
  });
});

describe("statusRange", () => {
  it("maps 200 to 2xx", () => {
    expect(statusRange(200)).toBe("2xx");
  });

  it("maps 301 to 3xx", () => {
    expect(statusRange(301)).toBe("3xx");
  });

  it("maps 404 to 4xx", () => {
    expect(statusRange(404)).toBe("4xx");
  });

  it("maps 500 to 5xx", () => {
    expect(statusRange(500)).toBe("5xx");
  });

  it("maps 100 to 1xx", () => {
    expect(statusRange(100)).toBe("1xx");
  });
});
