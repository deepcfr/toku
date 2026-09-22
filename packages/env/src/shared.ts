import { z } from "zod";

// node env — supports dev/prod/test plus debug for local verbose logging
export const nodeEnvSchema = z
  .enum(["development", "test", "production", "debug"])
  .default("development");

// shared url schemas to keep error messages consistent
export const redisUrlSchema = z.url();
export const databaseUrlSchema = z.url();
