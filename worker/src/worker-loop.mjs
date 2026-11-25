import { randomUUID } from "node:crypto";
import { claimNextJob, markJobRetryableFailure } from "./queue.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runWorkerLoop({
  pool, concurrency = 1, workerId = randomUUID(),
  processJob, pollIntervalMs = 1500, signal
}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required");
  if (typeof processJob !== "function") throw new Error("A job processor callback is required");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new Error("Worker concurrency must be between 1 and 2");
  }

  async function consume(slot) {
    const owner = `${workerId}-${slot}`;
    while (!signal?.aborted) {
      let job;
      try {
        job = await claimNextJob(pool, owner);
      } catch {
        await sleep(pollIntervalMs);
        continue;
      }

      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }

      try {
        await processJob(job, owner);
      } catch {
        // Persist a generic code only. Do not store customer content or secrets.
        await markJobRetryableFailure(pool, job.id, owner, "worker_processing_error").catch(() => {});
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, index) => consume(index + 1)));
}
