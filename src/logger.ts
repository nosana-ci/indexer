import pino from "pino";

function safeSerializeError(err: unknown): unknown {
  if (err === null || err === undefined || typeof err !== "object") {
    return err;
  }

  const obj = err as Record<string, unknown>;
  const result: Record<string, unknown> = {
    type: (obj.name as string) ?? (obj.constructor as { name?: string })?.name ?? "Error",
    message: obj.message,
    stack: obj.stack,
  };

  if (obj.code !== undefined) {
    result.code = obj.code;
  }

  // Serialize cause chain
  if (obj.cause !== undefined) {
    result.cause = safeSerializeError(obj.cause);
  }

  // Copy remaining enumerable properties (skip already-handled ones)
  const skip = new Set(["name", "message", "stack", "code", "cause"]);
  for (const key in obj) {
    if (!skip.has(key) && result[key] === undefined) {
      const val = obj[key];
      if (
        val &&
        typeof val === "object" &&
        typeof (val as Record<string, unknown>).message === "string"
      ) {
        result[key] = safeSerializeError(val);
      } else {
        result[key] = val;
      }
    }
  }

  return result;
}

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "blockchain-indexer", mode: process.env.APP_MODE ?? "all" },
  ...(process.env.APP_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
  serializers: {
    err: safeSerializeError,
  },
});

export default logger;
