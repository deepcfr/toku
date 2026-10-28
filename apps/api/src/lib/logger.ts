// base pino logger, centralized
import pino from "pino";
import { config } from "../config";

// output format
// colorized and formatted json in development, raw json in production
const transport = config.isPrettyLog
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    }
  : undefined;

// remove sensitive data from logs
const redact = {
  paths: ["passwordHash", "*.passwordHash"],
  censor: "PROTECTED",
};

export const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  transport,
  redact,
});

export type Logger = typeof logger;
