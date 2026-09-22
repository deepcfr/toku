import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { databaseUrlSchema, nodeEnvSchema, redisUrlSchema } from "./shared";

// bullmq worker — standalone process, shares redis with server
export const workerEnv = createEnv({
  server: {
    NODE_ENV: nodeEnvSchema,
    REDIS_URL: redisUrlSchema,
    DATABASE_URL: databaseUrlSchema.optional(),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    REDIS_URL: process.env.REDIS_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
