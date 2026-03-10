import { rateLimit, type Generator } from "elysia-rate-limit";

const getClientIP: Generator = (req, server) => {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");

  if (forwarded) return forwarded.split(",")[0].trim();
  if (realIp) return realIp;

  return server?.requestIP(req)?.address ?? "unknown";
};

const rateLimitError = new Response(
  JSON.stringify({
    error: "Rate limit exceeded",
    message: "Too many requests",
  }),
  {
    status: 429,
    headers: { "Content-Type": "application/json" },
  },
);

export const jobsRateLimit = () =>
  rateLimit({
    max: 20,
    duration: 30_000,
    errorResponse: rateLimitError,
    generator: getClientIP,
  });

export const jobsHourlyRateLimit = () =>
  rateLimit({
    max: 500,
    duration: 3_600_000,
    errorResponse: rateLimitError,
    generator: getClientIP,
  });

export const jobsDailyRateLimit = () =>
  rateLimit({
    max: 3000,
    duration: 86_400_000,
    errorResponse: rateLimitError,
    generator: getClientIP,
  });
