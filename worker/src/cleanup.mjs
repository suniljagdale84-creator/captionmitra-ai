import { randomUUID } from "node:crypto";

const TERMINAL_SOURCE_STATUSES = ["completed", "payment_failed", "processing_failed", "refunded", "expired", "cancelled"];

/**
 * Enqueue eligible files, then delete them using an injected private-storage
 * adapter. Never enqueue a source belonging to an active job or an output
 * before its retention expiry. Failed deletes remain retryable.
 *
 * deleteBlob(path, { access: "private" }) must throw on failure.
 */
export async function runBlobCleanup(pool, deleteBlob, {
  workerId = randomUUID(),
  batchSize = 25,
  retryDelaySeconds = 300
} = {}) {
  if (typeof deleteBlob !== "function") throw new Error("Blob deletion adapter is required");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Invalid cleanup batch size");

  const enqueued = await pool.query(
    `INSERT INTO caption_blob_cleanup_tasks (job_id, blob_kind, blob_path)
     SELECT id, 'source', source_blob_path
     FROM caption_jobs
     WHERE source_blob_path IS NOT NULL
       AND status = ANY($1::caption_job_status[])
     ON CONFLICT (job_id, blob_kind, blob_path) DO NOTHING`,
    [TERMINAL_SOURCE_STATUSES]
  );
  const outputEnqueued = await pool.query(
    `INSERT INTO caption_blob_cleanup_tasks (job_id, blob_kind, blob_path)
     SELECT id, 'result', result_blob_path
     FROM caption_jobs
     WHERE result_blob_path IS NOT NULL
       AND expires_at <= NOW()
       AND status IN ('completed', 'refunded', 'expired', 'processing_failed', 'cancelled')
     ON CONFLICT (job_id, blob_kind, blob_path) DO NOTHING`
  );

  const client = await pool.connect();
  let tasks = [];
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `SELECT id, job_id, blob_kind, blob_path
       FROM caption_blob_cleanup_tasks
       WHERE available_at <= NOW()
         AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '10 minutes')
       ORDER BY available_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [batchSize]
    );
    tasks = claimed.rows;
    if (tasks.length) {
      await client.query(
        `UPDATE caption_blob_cleanup_tasks
         SET locked_at = NOW(), locked_by = $2, updated_at = NOW()
         WHERE id = ANY($1::bigint[])`,
        [tasks.map(t => t.id), workerId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }

  let deleted = 0, retried = 0, skipped = 0;
  for (const task of tasks) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const locked = await db.query(
        `SELECT j.id, j.status, j.expires_at, j.source_blob_path, j.result_blob_path
         FROM caption_jobs j
         JOIN caption_blob_cleanup_tasks t ON t.job_id = j.id
         WHERE t.id = $1 AND t.locked_by = $2
         FOR UPDATE OF j, t`,
        [task.id, workerId]
      );
      const job = locked.rows[0];
      if (!job) {
        await db.query("DELETE FROM caption_blob_cleanup_tasks WHERE id = $1 AND locked_by = $2", [task.id, workerId]);
        await db.query("COMMIT");
        skipped++;
        continue;
      }
      const currentPath = task.blob_kind === "source" ? job.source_blob_path : job.result_blob_path;
      const eligible = task.blob_kind === "source"
        ? TERMINAL_SOURCE_STATUSES.includes(job.status)
        : Boolean(job.expires_at && new Date(job.expires_at).getTime() <= Date.now()) &&
          ["completed", "refunded", "expired", "processing_failed", "cancelled"].includes(job.status);
      if (currentPath !== task.blob_path || !eligible) {
        await db.query("DELETE FROM caption_blob_cleanup_tasks WHERE id = $1 AND locked_by = $2", [task.id, workerId]);
        await db.query("COMMIT");
        skipped++;
        continue;
      }
      await db.query("COMMIT");
    } catch (error) {
      try { await db.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      db.release();
    }

    try {
      await deleteBlob(task.blob_path, { access: "private" });
      const done = await pool.query(
        `UPDATE caption_jobs
         SET source_blob_path = CASE WHEN $2 = 'source' AND source_blob_path = $3 THEN NULL ELSE source_blob_path END,
             result_blob_path = CASE WHEN $2 = 'result' AND result_blob_path = $3 THEN NULL ELSE result_blob_path END,
             source_deleted_at = CASE WHEN $2 = 'source' THEN NOW() ELSE source_deleted_at END,
             result_deleted_at = CASE WHEN $2 = 'result' THEN NOW() ELSE result_deleted_at END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [task.job_id, task.blob_kind, task.blob_path]
      );
      if (done.rows.length) {
        await pool.query("DELETE FROM caption_blob_cleanup_tasks WHERE id = $1 AND locked_by = $2", [task.id, workerId]);
        deleted++;
      } else {
        skipped++;
      }
    } catch {
      await pool.query(
        `UPDATE caption_blob_cleanup_tasks
         SET attempt_count = attempt_count + 1,
             available_at = NOW() + ($3 * INTERVAL '1 second'),
             locked_at = NULL, locked_by = NULL,
             last_error_code = 'blob_delete_failed', updated_at = NOW()
         WHERE id = $1 AND locked_by = $2`,
        [task.id, workerId, retryDelaySeconds]
      );
      retried++;
    }
  }
  return {
    enqueued: (enqueued.rowCount || 0) + (outputEnqueued.rowCount || 0),
    claimed: tasks.length, deleted, retried, skipped
  };
}
