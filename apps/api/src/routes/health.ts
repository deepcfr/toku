import { Hono } from "hono";
import { db } from "../db";
import { redis } from "../redis";
import type { AppEnv } from "../types";

export const healthRoutes = new Hono<AppEnv>()
  // liveness check -> process is running
  .get("/", c => {
    return c.json({
      status: "ok",
      uptime: Math.floor(process.uptime()),
      timestamp: Date.now(),
    });
  })
  // readiness check -> the server is ready to accept traffic
  .get("/ready", async c => {
    // run both checks in parallel
    const [isDbUp, isRedisUp] = await Promise.all([
      db`SELECT 1`.then(() => true).catch(() => false),
      redis.client
        .ping()
        .then(res => res === "PONG")
        .catch(() => false),
    ]);

    const isReady = isDbUp && isRedisUp;

    return c.json(
      {
        status: isReady ? "ready" : "degraded",
        services: {
          db: isDbUp ? "up" : "down",
          redis: isRedisUp ? "up" : "down",
        },
        timestamp: Date.now(),
      },
      isReady ? 200 : 503
    );
  });
