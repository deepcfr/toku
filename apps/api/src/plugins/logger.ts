// injects ctx.logger into routes and auto-logs request durations (skips /health)
import { Elysia } from "elysia";
import { logger } from "../lib/logger";

const START_TIME = Symbol("startTime");

export const loggerPlugin = new Elysia({ name: "plugin:logger" })
  .decorate("logger", logger)
  .onRequest(({ request }) => {
    // we are extending the request object basically to store the start time
    // request[START_TIME] = 100_000_000;
    (request as unknown as Record<symbol, number>)[START_TIME] =
      Bun.nanoseconds();
  })
  .onAfterResponse({ as: "global" }, ({ request, set }) => {
    const url = new URL(request.url);

    // filter out health check noise
    if (url.pathname === "/health" || url.pathname === "/health/ready") {
      return;
    }

    const start = (request as unknown as Record<symbol, number>)[START_TIME];
    const durationMs = start
      ? Number(((Bun.nanoseconds() - start) / 1_000_000).toFixed(2))
      : 0;

    const status = typeof set.status === "number" ? set.status : 200;

    const logData = {
      method: request.method,
      path: url.pathname,
      status,
      durationMs,
    };

    if (status >= 500) {
      logger.error(logData, "HTTP request failed");
    } else if (status >= 400) {
      logger.warn(logData, "HTTP client error");
    } else {
      logger.info(logData, "HTTP request completed");
    }
  });
