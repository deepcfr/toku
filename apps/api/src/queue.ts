import { Queue, type DefaultJobOptions } from "bullmq";
import { WORKER_QUEUE_NAME } from "@toku/db";
import { config } from "./config";

/**
 * with exponential backoff we increase the retry delay every time by using 2 ^ (attemps - 1) * delay
 * if pg has a sudden hiccup all 1000 jobs try to write to pg and all of them fail at the exact same time
 * this keeps happening even though the delay gets longer because all 1000 jobs smash pg at the same time,
 * exponential backoff doesnt fix the traffic spike issue
 */

// instead of forcing 1000 jobs to wait exactly Ns, jitter adds some randomness to the wait time of each job
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
    jitter: 0.5,
  },
  removeOnComplete: true,
  removeOnFail: { count: 1000 },
};

export { WORKER_QUEUE_NAME };

// producer
export const workerQueue = new Queue(WORKER_QUEUE_NAME, {
  connection: { url: config.REDIS_URL },
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

// helper for graceful process termination
export async function closeQueue() {
  await workerQueue.close();
}
