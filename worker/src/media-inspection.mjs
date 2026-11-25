import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { downloadPrivateBlob } from "./blob-storage.mjs";
import { probeMedia } from "./media-tools.mjs";
import { calculatePricePaise } from "./pricing.mjs";

const ALLOWED_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo",
  "video/x-matroska", "audio/mpeg", "audio/mp3", "audio/wav",
  "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/flac", "audio/webm"
]);

async function claimInspection(pool, workerId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH candidate AS (
         SELECT inspection.job_id
         FROM caption_media_inspections AS inspection
         JOIN caption_jobs AS job ON job.id = inspection.job_id
         WHERE inspection.status = 'pending'
           AND inspection.available_at <= NOW()
           AND job.status = 'awaiting_payment'
           AND job.media_duration_seconds IS NULL
         ORDER BY inspection.available_at, inspection.created_at
         FOR UPDATE OF inspection SKIP LOCKED
         LIMIT 1
       )
       UPDATE caption_media_inspections AS inspection
       SET status = 'processing', locked_at = NOW(), locked_by = $1,
           attempt_count = attempt_count + 1, updated_at = NOW()
       FROM candidate
       JOIN caption_jobs AS job ON job.id = candidate.job_id
       WHERE inspection.job_id = candidate.job_id
       RETURNING job.id, job.source_blob_path, job.source_size_bytes,
                 job.source_content_type, inspection.attempt_count`,
      [workerId]
    );
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function completeInspection(pool, job, workerId, durationSeconds, amountPaise) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE caption_jobs
       SET media_duration_seconds = $2, amount_paise = $3,
           progress_stage = 'queued', progress_percent = 0,
           progress_updated_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'awaiting_payment'
         AND media_duration_seconds IS NULL
       RETURNING id`,
      [job.id, durationSeconds, amountPaise]
    );
    if (!updated.rows[0]) throw new Error("inspection_job_state_changed");
    const inspection = await client.query(
      `UPDATE caption_media_inspections
       SET status = 'completed', locked_at = NULL, locked_by = NULL,
           last_error_code = NULL, updated_at = NOW()
       WHERE job_id = $1 AND status = 'processing' AND locked_by = $2
       RETURNING job_id`,
      [job.id, workerId]
    );
    if (!inspection.rows[0]) throw new Error("inspection_lease_lost");
    await client.query(
      `INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
       VALUES ($1, 'awaiting_payment', 'awaiting_payment', 'media_duration_verified')`,
      [job.id]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function failInspection(pool, jobId, workerId, attemptCount, errorCode) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE caption_media_inspections
       SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END,
           available_at = NOW() + INTERVAL '15 seconds',
           locked_at = NULL, locked_by = NULL,
           last_error_code = $3, updated_at = NOW()
       WHERE job_id = $1 AND status = 'processing' AND locked_by = $2`,
      [jobId, workerId, errorCode]
    );
    if (attemptCount >= 3) {
      await client.query(
        `INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
         VALUES ($1, 'awaiting_payment', 'awaiting_payment', 'media_inspection_failed')`,
        [jobId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function inspectOneUploadedMedia({ pool, config, workerId = randomUUID(), dependencies = {} }) {
  const job = await claimInspection(pool, workerId);
  if (!job) return false;

  const makeTempDir = dependencies.mkdtemp || mkdtemp;
  const removeTemp = dependencies.rm || rm;
  const download = dependencies.downloadPrivateBlob || downloadPrivateBlob;
  const probe = dependencies.probeMedia || probeMedia;
  let workDir;
  try {
    if (!ALLOWED_TYPES.has(String(job.source_content_type || "").toLowerCase())) {
      throw new Error("unsupported_media_type");
    }
    const size = Number(job.source_size_bytes);
    if (!Number.isSafeInteger(size) || size < 1 || size > config.maxInputBytes) {
      throw new Error("invalid_media_size");
    }
    workDir = await makeTempDir(join(config.tempDir, "captionmitra-inspect-"));
    const sourcePath = join(workDir, "source.media");
    const downloaded = await download({
      pathname: job.source_blob_path,
      token: config.blobReadWriteToken,
      destination: sourcePath,
      tempDir: config.tempDir,
      maxBytes: config.maxInputBytes
    });
    if (downloaded.sizeBytes !== size ||
        (downloaded.contentType && downloaded.contentType.toLowerCase() !== job.source_content_type.toLowerCase())) {
      throw new Error("uploaded_media_metadata_mismatch");
    }
    const metadata = await probe(sourcePath);
    if (!Number.isFinite(metadata.durationSeconds) ||
        metadata.durationSeconds <= 0 ||
        metadata.durationSeconds > config.maxJobDurationSeconds) {
      throw new Error("unsupported_media_duration");
    }
    const amountPaise = calculatePricePaise(metadata.durationSeconds);
    await completeInspection(pool, job, workerId, metadata.durationSeconds, amountPaise);
    return { jobId: job.id, durationSeconds: metadata.durationSeconds, amountPaise };
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]{1,64}$/i.test(error.message)
      ? error.message : "media_inspection_error";
    await failInspection(pool, job.id, workerId, Number(job.attempt_count), code);
    return { jobId: job.id, failed: Number(job.attempt_count) >= 3 };
  } finally {
    if (workDir) await removeTemp(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runMediaInspectionLoop({ pool, config, concurrency = 1, signal, pollIntervalMs = 1500 }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new Error("Inspection concurrency must be between 1 and 2");
  }
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  async function consume(slot) {
    const workerId = `media-inspector-${slot}-${randomUUID()}`;
    while (!signal?.aborted) {
      try {
        const result = await inspectOneUploadedMedia({ pool, config, workerId });
        if (!result) await sleep(pollIntervalMs);
      } catch {
        await sleep(pollIntervalMs);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, index) => consume(index + 1)));
}
