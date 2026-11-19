import pino from "pino";
import { config } from "./config";

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

const redact = {
  paths: ["passwordHash", "*.passwordHash", "ciphertextHex", "ivHex"],
  censor: "PROTECTED",
};

export const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  transport,
  redact,
});

export type Logger = typeof logger;
