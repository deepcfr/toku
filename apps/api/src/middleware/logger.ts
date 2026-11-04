import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const startTime = Bun.nanoseconds();
  await next();

  // eliminate /health/* routes
  const path = c.req.path;
  if (path === "/health" || path === "/health/ready") return;

  const durationMs = Number(
    ((Bun.nanoseconds() - startTime) / 1_000_000).toFixed(2)
  );

  const status = c.res.status;

  const logData = {
    method: c.req.method,
    pathName: c.req.path,
    status,
    durationMs,
  };

  if (status >= 500) {
    c.var.logger.error(logData, "HTTP request failed");
  } else if (status >= 400) {
    c.var.logger.warn(logData, "HTTP client error");
  } else {
    c.var.logger.info(logData, "HTTP request completed");
  }
});
