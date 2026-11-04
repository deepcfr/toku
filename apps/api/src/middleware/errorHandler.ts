import { ZodError } from "zod";
import { RateLimitExceededError } from "@toku/redis";
import { config } from "../config";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { AppContext } from "../types";

export function errorHandler(e: Error, c: AppContext) {
  // domain specific errors (AppError)
  if (e instanceof AppError) {
    return c.json(
      {
        code: e.code,
        message: e.message,
        ...(e.details !== undefined ? { details: e.details } : {}),
      },
      e.status
    );
  }

  // rate limit exceeded error
  if (e instanceof RateLimitExceededError) {
    c.header("Retry-After", e.result.retryAfter.toString());
    c.header("X-RateLimit-Remaining", e.result.remaining.toString());
    c.header(
      "X-RateLimit-Reset",
      Math.ceil(e.result.resetAt / 1000).toString()
    );

    return c.json(
      {
        code: e.code,
        message: e.message,
        retryAfter: e.result.retryAfter,
      },
      429
    );
  }

  // validation error
  if (e instanceof ZodError || e.name === "ZodError") {
    return c.json(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid request parameters",
        details: (e as ZodError).issues,
      },
      400
    );
  }

  // unexpected crash
  const log = c.var?.logger ?? logger;
  log.error({ err: e }, "Unhandled server error");

  return c.json(
    {
      code: "INTERNAL_SERVER_ERROR",
      message: config.isProduction
        ? "Internal server error"
        : e.message || "Internal server error",
    },
    500
  );
}

// for non-existing routes
export function notFoundHandler(c: AppContext) {
  return c.json(
    {
      code: "NOT_FOUND",
      message: "Route not found",
    },
    404
  );
}
