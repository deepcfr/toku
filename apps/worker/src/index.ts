import { db } from "./db";
import { logger } from "./logger";
import { processCleanup } from "./processors/cleanerProcessor";
import { createTokuWorker } from "./worker";

const CLEANUP_INTERVAL_MS = 60 * 1000; // periodic cleanup sweep interval

logger.info("Starting Toku background worker service...");

const worker = createTokuWorker();

// initial sweep upon boot, then periodically
processCleanup().catch(err => {
  logger.error({ error: err.message }, "Error during initial cleanup sweep");
});

const cleanupTimer = setInterval(() => {
  processCleanup().catch(err => {
    logger.error({ error: err.message }, "Error during periodic cleanup sweep");
  });
}, CLEANUP_INTERVAL_MS);

// graceful shutdown
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Gracefully terminating background worker...");

  clearInterval(cleanupTimer);

  try {
    await worker.close();
    logger.info("BullMQ worker drained and closed");

    await db.end();
    logger.info("Database connections closed");
  } catch (err: unknown) {
    logger.error(
      { error: (err as Error).message },
      "Error during graceful shutdown"
    );
    process.exit(1);
  }

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
