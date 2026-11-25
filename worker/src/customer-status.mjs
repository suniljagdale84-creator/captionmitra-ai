import { hashCustomerAccessToken, verifyCustomerAccessToken } from "./customer-access-token.mjs";
import { getPublicProgress } from "./job-progress.mjs";

const PUBLIC_STATUSES = new Set([
  "awaiting_upload","uploaded","awaiting_payment","paid","queued","processing",
  "completed","payment_failed","processing_failed","expired","cancelled"
]);

export async function getCustomerJobStatus({ pool, jobId, accessToken, now = Date.now() }) {
  if (!pool || typeof pool.query !== "function") throw new Error("A PostgreSQL pool is required");
  if (typeof jobId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error("Invalid job identifier");
  }

  let tokenHash;
  try { tokenHash = hashCustomerAccessToken(accessToken); }
  catch { throw new Error("Invalid customer access token"); }

  const result = await pool.query(
    `SELECT status, amount_paise, currency, output_language,
            progress_stage, progress_percent, progress_updated_at,
            payment_verified_at, result_blob_path, expires_at,
            customer_access_token_hash,
            inspection.status AS inspection_status,
            inspection.last_error_code AS inspection_error_code
     FROM caption_jobs
     LEFT JOIN caption_media_inspections AS inspection ON inspection.job_id = caption_jobs.id
     WHERE caption_jobs.id = $1 LIMIT 1`,
    [jobId]
  );
  const job = result.rows[0];
  if (!job || !verifyCustomerAccessToken(accessToken, job.customer_access_token_hash) ||
      tokenHash !== job.customer_access_token_hash) {
    throw new Error("Job status is unavailable");
  }

  const expired = job.expires_at && new Date(job.expires_at).getTime() <= now;
  const status = expired && job.status === "completed" ? "expired" : job.status;
  const progress = getPublicProgress(
    PUBLIC_STATUSES.has(status) ? status : "unknown",
    job.progress_stage,
    job.progress_percent
  );
  return {
    jobId,
    status: progress.status,
    stage: progress.stage,
    inspection: {
      status: job.inspection_status || "not_started",
      error: job.inspection_status === "failed" ? "media_inspection_failed" : null
    },
    progressPercent: progress.percent,
    outputLanguage: job.output_language,
    payment: {
      status: job.payment_verified_at ? "verified" :
        (job.status === "payment_failed" ? "failed" :
          (["awaiting_payment","uploaded","awaiting_upload"].includes(job.status) ? "pending" : "unknown")),
      amountPaise: Number.isSafeInteger(Number(job.amount_paise)) ? Number(job.amount_paise) : null,
      currency: job.currency || "INR"
    },
    downloads: {
      available: status === "completed" && Boolean(job.result_blob_path) && !expired,
      formats: status === "completed" && Boolean(job.result_blob_path) && !expired ? ["srt","txt"] : []
    },
    expiresAt: job.expires_at ? new Date(job.expires_at).toISOString() : null,
    progressUpdatedAt: job.progress_updated_at ? new Date(job.progress_updated_at).toISOString() : null
  };
}
