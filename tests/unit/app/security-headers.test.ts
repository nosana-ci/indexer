import { describe, it, expect, vi } from "vitest";
import { Elysia } from "elysia";

vi.mock("../../../src/modules/jobs/service", () => ({
  JobsService: class {},
}));

vi.mock("../../../src/middleware/rate-limit", () => ({
  jobsRateLimit: () => new Elysia(),
  jobsHourlyRateLimit: () => new Elysia(),
  jobsDailyRateLimit: () => new Elysia(),
}));

import { createApp, securityHeaders } from "../../../src/app";

describe("Security headers", () => {
  const app = createApp().get("/test", () => "ok");

  it.each(Object.entries(securityHeaders))(
    "should set %s header to %s on successful responses",
    async (headerName, headerValue) => {
      const response = await app.handle(new Request("http://localhost/test"));
      expect(response.headers.get(headerName)).toBe(headerValue);
    },
  );

  it.each(Object.entries(securityHeaders))(
    "should set %s header to %s on error responses",
    async (headerName, headerValue) => {
      const response = await app.handle(new Request("http://localhost/not-found"));
      expect(response.headers.get(headerName)).toBe(headerValue);
    },
  );
});
