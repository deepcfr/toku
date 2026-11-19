import { workerEnv } from "@toku/env/worker";

const defaultLogLevel = () => {
  if (workerEnv.NODE_ENV === "test") return "silent";
  if (workerEnv.NODE_ENV === "debug") return "debug";
  return "info";
};

export const config = {
  ...workerEnv,
  isProduction: workerEnv.NODE_ENV === "production",
  isDevelopment: workerEnv.NODE_ENV === "development",
  isDebug: workerEnv.NODE_ENV === "debug",
  isTest: workerEnv.NODE_ENV === "test",

  logLevel: defaultLogLevel(),
  isPrettyLog: workerEnv.NODE_ENV !== "production",
} as const;

export type Config = typeof config;
