import Elysia from "elysia";
import { db } from "../db";
import { redis } from "../redis";

export const healthRoutes = new Elysia({ prefix: "/health" })
  // liveness check -> process is runnning
  .get("/", () => ({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
  }))
  // readiness check -> the server is ready to accept traffic
  .get("/ready", async ({ set }) => {
    // run both checks in parallel
    const [isDbUp, isRedisUp] = await Promise.all([
      db`SELECT 1`.then(() => true).catch(() => false),
      redis.client
        .ping()
        .then(res => res === "PONG")
        .catch(() => false),
    ]);

    const isReady = isDbUp && isRedisUp;

    if (!isReady) {
      set.status = 503; // service temporarily unavailable
    }

    return {
      status: isReady ? "ready" : "degraded",
      services: {
        db: isDbUp ? "up" : "down",
        redis: isRedisUp ? "up" : "down",
      },
      timestamp: Date.now(),
    };
  });
