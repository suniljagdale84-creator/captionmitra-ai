import { probeMedia } from "./media-tools.mjs";
import { calculatePricePaise } from "./pricing.mjs";

/**
 * Probe the downloaded source on the worker, then persist the verified duration
 * and exact prorata amount. Only uploaded/awaiting_payment jobs may be priced.
 */
export async function verifyDurationAndPrice(pool, jobId, sourcePath, probe = probeMedia) {
  if (typeof jobId !== "string" || jobId.length < 1 || jobId.length > 128) {
    throw new Error("Invalid job identifier");
  }

  const media = await probe(sourcePath);
  const amountPaise = calculatePricePaise(media.durationSeconds);

  const result = await pool.query(
    `UPDATE caption_jobs
     SET media_duration_seconds = $2,
         amount_paise = $3,
         status = 'awaiting_payment',
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('uploaded', 'awaiting_payment')
       AND source_blob_path IS NOT NULL
     RETURNING id, media_duration_seconds, amount_paise, currency, status`,
    [jobId, media.durationSeconds, amountPaise]
  );

  if (!result.rows[0]) {
    throw new Error("Job is not eligible for duration verification");
  }

  return {
    ...result.rows[0],
    mediaDurationSeconds: Number(result.rows[0].media_duration_seconds),
    amountPaise: Number(result.rows[0].amount_paise)
  };
}
