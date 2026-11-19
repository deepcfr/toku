import { Worker, type Job } from "bullmq";
import { config } from "./config";
import { logger } from "./logger";
import { processCleanup } from "./processors/cleanerProcessor";
import {
  processMarkDelivered,
  processTrackMessage,
} from "./processors/messageProcessor";
import { WORKER_QUEUE_NAME, type WorkerJob } from "./types";

export function createTokuWorker(
  concurrency = config.WORKER_CONCURRENCY
): Worker<WorkerJob> {
  const worker = new Worker<WorkerJob>(
    WORKER_QUEUE_NAME,
    async (job: Job<WorkerJob>) => {
      logger.debug(
        { jobId: job.id, jobName: job.name, type: job.data.type },
        "Processing background job"
      );

      switch (job.data.type) {
        case "TRACK_MESSAGE":
          await processTrackMessage(job.data);
          break;
        case "MARK_DELIVERED":
          await processMarkDelivered(job.data);
          break;
        case "CLEANUP_EXPIRED":
          await processCleanup();
          break;
        default:
          logger.warn({ jobData: job.data }, "Unknown background job type");
      }
    },
    {
      connection: { url: config.REDIS_URL },
      concurrency,
    }
  );

  worker.on("completed", job => {
    logger.debug(
      { jobId: job.id, jobName: job.name },
      "Job completed successfully"
    );
  });

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, jobName: job?.name, error: err.message },
      "Job failed"
    );
  });

  worker.on("error", err => {
    logger.error({ error: err.message }, "BullMQ worker connection error");
  });

  return worker;
}
