import app from "./app";
import { config } from "./config";
import { db } from "./db";
import { logger } from "./lib/logger";
import { connectRedis, disconnectRedis } from "./redis";

let server: ReturnType<typeof Bun.serve> | undefined;
let isShuttingDown = false; // guard to prevent duplicate concurrent shutdowns (e.g. repeated Ctrl+C)

// graceful shutdown: orderly teardown to avoid dropping in-flight requests or corrupting data
async function shutdown(signal: string) {
  // handle multiple shutdown signals within a short span of time
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(
    { signal },
    "--- Shutdown signal received, starting graceful teardown ---"
  );

  // fail-safe: force exit if graceful cleanup hangs (e.g. stalled socket or query lock)
  // .unref() ensures this timer doesn't keep the event loop alive if cleanup finishes early
  const forceExitTimer = setTimeout(() => {
    logger.error("*** Graceful shutdown timed out after 10s, forcing exit ***");
    process.exit(1);
  }, 10_000);

  forceExitTimer.unref();

  try {
    // stop taking new HTTP requests first (pending requests are allowed to finish)
    if (server) {
      await server.stop();
      logger.info("--- HTTP server stopped accepting new connections ---");
    }

    // disconnect redis clients
    await disconnectRedis();
    logger.info("--- Redis connections closed ---");

    // drain & close Postgres connection pool ({ timeout: 5 } forces close after 5s)
    await db.end({ timeout: 5 });
    logger.info("--- Database connection pool closed ---");

    logger.info("--- Graceful shutdown completed successfully ---");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "*** Error during graceful shutdown ***");
    process.exit(1);
  }
}

// signal listeners: trap OS termination signals
process.on("SIGINT", () => void shutdown("SIGINT")); // sent by OS when pressing Ctrl+C in terminal
process.on("SIGTERM", () => void shutdown("SIGTERM")); // standard signal sent by docker/k8s/cloud on container stop

// process crash guards: fail-fast on unhandled exceptions to prevent running in a corrupted state
process.on("unhandledRejection", reason => {
  logger.fatal({ err: reason }, "*** Unhandled promise rejection ***");
  process.exit(1);
});

process.on("uncaughtException", reason => {
  logger.fatal({ err: reason }, "*** Uncaught exception ***");
  process.exit(1);
});

// bootstrap the server: fail-fast on dependencies before opening the public HTTP port
async function startServer() {
  try {
    logger.info("--- Connecting to Redis ---");
    await connectRedis();
    logger.info("--- Redis connected ---");

    server = Bun.serve({
      port: config.PORT,
      hostname: config.HOST,
      fetch: app.fetch,
    });

    logger.info(
      {
        port: server.port,
        host: server.hostname,
        env: config.NODE_ENV,
      },
      "--- Server listening ---"
    );
  } catch (error) {
    logger.fatal({ err: error }, "*** Failed to start server ***");
    process.exit(1);
  }
}

void startServer();
