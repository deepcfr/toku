import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { databaseUrlSchema, nodeEnvSchema, redisUrlSchema } from "./shared";

// combined http+ws server (fastify) — single port for http and websocket upgrade
// future split: keeping this as-is; splitting into api.ts (http) and realtime.ts (ws) reuses these schemas
export const serverEnv = createEnv({
  server: {
    NODE_ENV: nodeEnvSchema,
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: databaseUrlSchema,
    REDIS_URL: redisUrlSchema,
    WEB_ORIGIN: z.url().default("http://localhost:5173"),

    // optional — for separate http/ws deploys only
    // WS_PORT: z.coerce.number().int().positive().optional(),
    // WS_ORIGIN: z.url().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
