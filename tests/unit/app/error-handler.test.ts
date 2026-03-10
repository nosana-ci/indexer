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

import { createApp } from "../../../src/app";
import { AppError, ValidationError } from "../../../src/errors";

describe("Error handler", () => {
  it("should return structured response for AppError", async () => {
    const app = createApp().get("/test-app-error", () => {
      throw new AppError("Resource not found", 404, "NOT_FOUND");
    });

    const response = await app.handle(new Request("http://localhost/test-app-error"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.message).toBe("Resource not found");
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should return structured response for ValidationError", async () => {
    const app = createApp().get("/test-validation-error", () => {
      throw new ValidationError("Invalid input");
    });

    const response = await app.handle(new Request("http://localhost/test-validation-error"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Invalid input");
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should handle duck-typed error objects with status and message", async () => {
    const app = createApp().get("/test-duck-error", () => {
      throw Object.assign(new Error("Bad request"), { status: 400, message: "Bad request" });
    });

    const response = await app.handle(new Request("http://localhost/test-duck-error"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Bad request");
  });

  it("should return 500 for unhandled errors", async () => {
    const app = createApp().get("/test-unhandled", () => {
      throw new Error("Something broke");
    });

    const response = await app.handle(new Request("http://localhost/test-unhandled"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).toBe("Internal server error");
  });

  it("should return AppError without code when code is omitted", async () => {
    const app = createApp().get("/test-no-code", () => {
      throw new AppError("Server error", 503);
    });

    const response = await app.handle(new Request("http://localhost/test-no-code"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.message).toBe("Server error");
  });
});
