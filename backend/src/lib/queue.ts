import { Queue, Worker, Job } from "bullmq";
import { config } from "../config";

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || "6379"),
};

// ─── Queues ─────────────────────────────────────────────────

export const aiQueue = new Queue("ai-tasks", { connection });
export const deployQueue = new Queue("deploy-tasks", { connection });
export const automationQueue = new Queue("automation-tasks", { connection });
export const integrationQueue = new Queue("integration-sync", { connection });

// ─── Helper to create workers ───────────────────────────────

export function createWorker<T = any>(
  queueName: string,
  processor: (job: Job<T>) => Promise<any>,
  concurrency = 3
): Worker<T> {
  const worker = new Worker<T>(queueName, processor, {
    connection,
    concurrency,
  });

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} in ${queueName} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} in ${queueName} completed`);
  });

  return worker;
}
