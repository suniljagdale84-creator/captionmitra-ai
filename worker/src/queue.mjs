const CLAIM_SQL = `
  WITH candidate AS (
    SELECT id
    FROM caption_jobs
    WHERE status = 'queued'
      AND available_at <= NOW()
      AND retry_count <= max_retries
    ORDER BY available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE caption_jobs AS job
  SET status = 'processing',
      locked_at = NOW(),
      locked_by = $1,
      updated_at = NOW()
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.id, job.source_blob_path, job.source_size_bytes,
            job.source_content_type, job.media_duration_seconds,
            job.output_language, job.retry_count, job.max_retries
`;

export async function claimNextJob(pool, workerId) {
  if (typeof workerId !== "string" || workerId.length < 1 || workerId.length > 128) {
    throw new Error("Invalid worker identifier");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(CLAIM_SQL, [workerId]);
    if (result.rows[0]) {
      await client.query(
        `INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
         VALUES ($1, 'queued', 'processing', 'worker_claimed')`,
        [result.rows[0].id]
      );
    }
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markJobRetryableFailure(pool, jobId, workerId, errorCode) {
  if (typeof errorCode !== "string" || !/^[a-z0-9_]{1,64}$/i.test(errorCode)) {
    throw new Error("Invalid error code");
  }

  if (typeof workerId !== "string" || workerId.length < 1 || workerId.length > 128) {
    throw new Error("Invalid worker identifier");
  }

  const result = await pool.query(
    `UPDATE caption_jobs
     SET status = CASE WHEN retry_count < max_retries THEN 'queued'::caption_job_status
                       ELSE 'processing_failed'::caption_job_status END,
         retry_count = retry_count + 1,
         available_at = NOW() + LEAST((POWER(2, retry_count)::int), 300) * INTERVAL '1 second',
         locked_at = NULL,
         locked_by = NULL,
         error_code = $2,
         updated_at = NOW()
     WHERE id = $1 AND status = 'processing' AND locked_by = $3
     RETURNING id, status, retry_count`,
    [jobId, errorCode, workerId]
  );
  return result.rows[0] ?? null;
}

export async function completeJob(pool, jobId, workerId, resultBlobPath) {
  if (typeof resultBlobPath !== "string" || resultBlobPath.length < 1 || resultBlobPath.length > 1024) {
    throw new Error("Invalid result storage path");
  }

  if (typeof workerId !== "string" || workerId.length < 1 || workerId.length > 128) {
    throw new Error("Invalid worker identifier");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE caption_jobs
       SET status = 'completed', result_blob_path = $2,
           locked_at = NULL, locked_by = NULL,
           error_code = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND locked_by = $3
       RETURNING id`,
      [jobId, resultBlobPath, workerId]
    );
    if (updated.rows[0]) {
      await client.query(
        `INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
         VALUES ($1, 'processing', 'completed', 'worker_completed')`,
        [jobId]
      );
    }
    await client.query("COMMIT");
    return Boolean(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
