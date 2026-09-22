import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { nodeEnvSchema } from "./shared";

// vite react client — validation runs in vite.config.ts and at runtime via import
export const webEnv = createEnv({
  server: {
    NODE_ENV: nodeEnvSchema,
  },
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.url(),
    VITE_WS_URL: z.url(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    VITE_API_URL: process.env.VITE_API_URL,
    VITE_WS_URL: process.env.VITE_WS_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
