import pino from "pino";
import { env } from "../config/env.ts";

const isPretty = process.env.NODE_ENV !== "production";

export const loggerOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL ?? "info",
  transport: isPretty
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
};

export const logger = pino(loggerOptions);

export const createLogger = (bindings: pino.Bindings) => logger.child(bindings);
