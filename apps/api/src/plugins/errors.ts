import Elysia from "elysia";
import { RateLimitExceededError } from "@toku/redis";
import { config } from "../config";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";

export const errorPlugin = new Elysia({ name: "plugin:errors" }).onError(
  { as: "global" }, // catches all the global errors
  ({ code, error, set }) => {
    // domain specific errors (AppError)
    if (error instanceof AppError) {
      set.status = error.status;

      return {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      };
    }

    // rate limit exceeded error
    if (error instanceof RateLimitExceededError) {
      set.status = 429;

      // set the standard rate-limit headers
      set.headers["retry-after"] = error.result.retryAfter.toString();
      set.headers["X-RateLimit-Remaining"] = error.result.remaining.toString();
      // ceil to epoch seconds so client doesn't retry ms early and re-trigger 429
      set.headers["X-RateLimit-Reset"] = Math.ceil(
        error.result.resetAt / 1000
      ).toString();

      return {
        code: error.code,
        message: error.message,
        retryAfter: error.result.retryAfter,
      };
    }

    // elysia specific errors

    // schema validation
    if (code === "VALIDATION") {
      set.status = 400;

      return {
        code: "VALIDATION_ERROR",
        message: "Invalid request parameters",
        details: error.all,
      };
    }

    // unknown route
    if (code === "NOT_FOUND") {
      set.status = 404;

      return {
        code: "NOT_FOUND",
        message: "Route not found",
      };
    }

    // unhandled server error (fallback)
    logger.error({ err: error }, "Unhandled server error");
    set.status = 500;

    return {
      code: "INTERNAL_SERVER_ERROR",
      message: config.isProduction
        ? "Internal server error"
        : error instanceof Error
          ? error.message
          : "Internal server error",
    };
  }
);
