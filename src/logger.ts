import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "blockchain-indexer", mode: process.env.APP_MODE ?? "all" },
  serializers: {
    err(err: unknown) {
      if (err === null || err === undefined || typeof err !== "object") {
        return err;
      }
      if (!Object.isExtensible(err)) {
        const { name, message, stack, code, ...rest } = err as Record<string, unknown>;
        return { type: name ?? "Error", message, stack, ...(code ? { code } : {}), ...rest };
      }
      return pino.stdSerializers.err(err as Error);
    },
  },
});

export default logger;
