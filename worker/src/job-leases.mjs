/**
 * Lease maintenance for jobs claimed by a worker.
 * Heartbeats and stale-job recovery are conditional on current ownership.
 */
export async function heartbeatJob(pool, jobId, workerId) {
  const result = await pool.query(
    `UPDATE caption_jobs
     SET locked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'processing' AND locked_by = $2
     RETURNING id`,
    [jobId, workerId]
  );
  return Boolean(result.rows[0]);
}

/**
 * Recover expired worker leases atomically. A recovered job is re-queued
 * with a short delay; exhausted jobs become processing_failed.
 */
export async function reclaimStaleJobs(pool, leaseSeconds = 120) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) {
    throw new Error("Lease timeout must be between 30 and 3600 seconds");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recovered = await client.query(
      `WITH stale AS (
         SELECT id, retry_count, max_retries
         FROM caption_jobs
         WHERE status = 'processing'
           AND locked_at < NOW() - ($1 * INTERVAL '1 second')
         ORDER BY locked_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 25
       ), changed AS (
         UPDATE caption_jobs AS job
         SET status = CASE WHEN stale.retry_count < stale.max_retries
                           THEN 'queued'::caption_job_status
                           ELSE 'processing_failed'::caption_job_status END,
             retry_count = job.retry_count + 1,
             available_at = NOW() + INTERVAL '5 seconds',
             locked_at = NULL,
             locked_by = NULL,
             error_code = 'worker_lease_expired',
             updated_at = NOW()
         FROM stale
         WHERE job.id = stale.id
         RETURNING job.id, job.status
       )
       SELECT id, status FROM changed`,
      [leaseSeconds]
    );

    for (const job of recovered.rows) {
      await client.query(
        `INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
         VALUES ($1, 'processing', $2, 'worker_lease_expired')`,
        [job.id, job.status]
      );
    }
    await client.query("COMMIT");
    return { recovered: recovered.rows.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
