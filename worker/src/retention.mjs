import { del } from "@vercel/blob";

const BATCH_SIZE = 25;

export async function cleanupExpiredJobs({ pool, blobToken, deleteBlob = del, batchSize = BATCH_SIZE } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required");
  if (!blobToken) throw new Error("Blob read/write token is required");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Invalid cleanup batch size");

  const client = await pool.connect();
  let removed = 0;
  let failed = 0;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id, source_blob_path, result_blob_path FROM caption_jobs " +
      "WHERE expires_at <= NOW() AND status NOT IN ('processing', 'queued', 'expired') " +
      "ORDER BY expires_at ASC FOR UPDATE SKIP LOCKED LIMIT $1",
      [batchSize]
    );

    // Keep row locks until remote deletion and database updates finish. This prevents
    // two cleanup workers from deleting the same expired job concurrently.
    for (const job of result.rows) {
      const paths = [job.source_blob_path, job.result_blob_path].filter(Boolean);
      let allDeleted = true;
      for (const pathname of paths) {
        try {
          await deleteBlob(pathname, { access: "private", token: blobToken });
        } catch {
          allDeleted = false;
          failed += 1;
        }
      }
      if (!allDeleted) continue;

      const update = await client.query(
        "UPDATE caption_jobs SET status = 'expired', source_blob_path = NULL, result_blob_path = NULL, updated_at = NOW() " +
        "WHERE id = $1 AND expires_at <= NOW() AND status NOT IN ('processing', 'queued', 'expired') RETURNING id",
        [job.id]
      );
      if (update.rows[0]) {
        await client.query(
          "INSERT INTO caption_job_events (job_id, from_status, to_status, event_code) VALUES ($1, NULL, 'expired', 'retention_cleanup_completed')",
          [job.id]
        );
        removed += 1;
      }
    }
    await client.query("COMMIT");
    return { examined: result.rows.length, expiredJobs: removed, deletionFailures: failed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
