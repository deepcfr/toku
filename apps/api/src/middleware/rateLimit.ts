// rate limit middleware
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createRateLimiter, type RateLimitConfig } from "@toku/redis";
import { redis } from "../redis";
import type { AppEnv } from "../types";

// note -> we will use different targets in different scenarios like pubKey/roomToken, but the default is clientIp
// extend the RateLimitConfig to add different key support
export interface RateLimitMiddlewareConfig extends RateLimitConfig {
  key?: (c: Context) => string;
}

/** step 1 -> extract the client ip
 * step 2 -> check with limiter.assert(clientIp)
 * step 3 -> if limit exceeded throw RateLimitExceededError, else set the header and call next()
 */
export function getClientIp(c: Context) {
  // the request passes through reverse proxy, load balancer etc and they add their own ips which are stored in the x-forwarded-for header as a single string -> "203.0.113.195, 141.101.96.15", we split it into an array of strings -> ["203.0.113.195", " 141.101.96.15"] -> the first one is the original client ip
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "127.0.0.1";
  }

  return (
    c.req.header("x-real-ip") ?? c.req.header("cf-connecting-ip") ?? "127.0.0.1"
  );
}

export function rateLimiter(config: RateLimitMiddlewareConfig) {
  const limiter = createRateLimiter(redis.client, config);

  return createMiddleware<AppEnv>(async (c, next) => {
    const target = config.key ? config.key(c) : getClientIp(c);
    await limiter.assert(target);
    await next();
  });
}
