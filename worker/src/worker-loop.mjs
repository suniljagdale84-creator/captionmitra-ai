import { randomUUID } from "node:crypto";
import { claimNextJob, markJobRetryableFailure } from "./queue.mjs";
import { heartbeatJob, reclaimStaleJobs } from "./job-leases.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runWorkerLoop({
  pool, concurrency = 1, workerId = randomUUID(),
  processJob, pollIntervalMs = 1500, signal,
  heartbeatIntervalMs = 30_000, leaseSeconds = 120
}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required");
  if (typeof processJob !== "function") throw new Error("A job processor callback is required");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new Error("Worker concurrency must be an integer between 1 and 2");
  }
  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 5_000 ||
      heartbeatIntervalMs >= leaseSeconds * 1000) {
    throw new Error("Heartbeat interval must be at least 5 seconds and shorter than the lease");
  }

  const recoveryTimer = setInterval(() => {
    void reclaimStaleJobs(pool, leaseSeconds).catch(() => {});
  }, Math.max(heartbeatIntervalMs, 15_000));
  recoveryTimer.unref?.();

  async function processWithHeartbeat(job, owner) {
    let lostLease = false;
    const timer = setInterval(() => {
      void heartbeatJob(pool, job.id, owner).then(alive => {
        if (!alive) lostLease = true;
      }).catch(() => { lostLease = true; });
    }, heartbeatIntervalMs);
    timer.unref?.();
    try {
      await processJob(job, owner);
      if (lostLease) throw new Error("Worker lease was lost during processing");
    } finally {
      clearInterval(timer);
    }
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
        await processWithHeartbeat(job, owner);
      } catch {
        // Conditional on current owner: a worker that lost its lease cannot
        // overwrite the newer worker's state.
        await markJobRetryableFailure(pool, job.id, owner, "worker_processing_error").catch(() => {});
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, (_, index) => consume(index + 1)));
  } finally {
    clearInterval(recoveryTimer);
  }
}
