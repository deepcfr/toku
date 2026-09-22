// Lua script is loaded once via SCRIPT LOAD and executed via EVALSHA
import { join } from "path";
import type { RedisClientType } from "redis";
import { RedisKeys } from "./keys";

const scriptPath = join(import.meta.dir, "scripts", "sliding-window.lua");
const SLIDING_WINDOW_LUA = await Bun.file(scriptPath).text();

// one client can be rate limited for several reasons
export const RateLimitAction = {
  WS_CONNECT: "ws_connect",
  SEND_MESSAGE: "send_message",
  ROOM_CREATE: "room_create",
} as const;

export type RateLimitAction =
  (typeof RateLimitAction)[keyof typeof RateLimitAction];

export interface RateLimitConfig {
  action: RateLimitAction;
  windowMs: number;
  limit: number;
}

export interface RateLimitresult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

export class RateLimitExceededError extends Error {
  public readonly code = "RATE_LIMIT_EXCEEDED";
  public readonly result: RateLimitresult;

  constructor(result: RateLimitresult, message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitExceededError";
    this.result = result;
    Error.captureStackTrace(this, RateLimitExceededError);
  }
}

export function createRateLimiter(
  redis: RedisClientType,
  config: RateLimitConfig
) {
  let cachedSha: string | null = null;

  async function load(): Promise<string> {
    if (cachedSha) return cachedSha;
    cachedSha = (await redis.scriptLoad(SLIDING_WINDOW_LUA)) as string;
    return cachedSha;
  }

  // returns result, does not throw on limit
  async function check(target: string): Promise<RateLimitresult> {
    if (!cachedSha) await load();

    const key = RedisKeys.rateLimit(config.action, target);
    const now = Date.now();

    let raw: unknown;
    try {
      raw = await redis.evalSha(cachedSha!, {
        keys: [key],
        arguments: [String(now), String(config.windowMs), String(config.limit)],
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("NOSCRIPT")) {
        cachedSha = null;
        await load();
        raw = await redis.evalSha(cachedSha!, {
          keys: [key],
          arguments: [
            String(now),
            String(config.windowMs),
            String(config.limit),
          ],
        });
      } else {
        throw err;
      }
    }

    if (!Array.isArray(raw) || raw.length !== 4) {
      throw new Error("Invalid response from rate limiter Lua script");
    }

    const [allowed, remaining, resetAt, retryAfter] = raw;

    if (
      typeof allowed !== "number" ||
      typeof remaining !== "number" ||
      typeof resetAt !== "number" ||
      typeof retryAfter !== "number"
    ) {
      throw new Error("Invalid response types from rate limiter Lua script");
    }

    return {
      allowed: allowed === 1,
      remaining: Math.max(0, remaining),
      resetAt,
      retryAfter: Math.max(0, retryAfter),
    };
  }

  // throws RateLimitExceededError if not allowed — convenient for Fastify routes
  async function assert(target: string): Promise<void> {
    const result = await check(target);
    if (!result.allowed) {
      throw new RateLimitExceededError(result);
    }
  }

  return { load, check, assert };
}
