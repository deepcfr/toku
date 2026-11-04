// gives each incoming request a unique tracking id (if they dont have)
// useful for logging and debugging -> can isolate and trace the complete lifecycle of a specific request
import { createMiddleware } from "hono/factory";
import { logger } from "../lib/logger";
import type { AppEnv } from "../types";

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = c.req.header("x-request-id") ?? crypto.randomUUID();

  // load into the context
  c.set("requestId", id);

  // pino child logger -> any log messages produced during this request is automatically tagged with requestId
  c.set("logger", logger.child({ requestId: id }));

  await next();

  c.res.headers.set("X-Request-Id", id);
});
