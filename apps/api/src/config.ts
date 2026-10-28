import { serverEnv } from "@toku/env/server";

// set default log level
const defaultLogLevel = () => {
  if (serverEnv.NODE_ENV === "test") return "silent";
  if (serverEnv.NODE_ENV === "debug") return "debug";
  return "info";
};

// typed configuration object
export const config = {
  ...serverEnv,
  isProduction: serverEnv.NODE_ENV === "production",
  isDevelopment: serverEnv.NODE_ENV === "development",
  isDebug: serverEnv.NODE_ENV === "debug",
  isTest: serverEnv.NODE_ENV === "test",

  // logging settings
  logLevel: serverEnv.LOG_LEVEL ?? defaultLogLevel(),
  isPrettyLog: serverEnv.NODE_ENV !== "production",
} as const;

export type Config = typeof config;
