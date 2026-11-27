import { createHash } from "node:crypto";

function safeFilename(pathname) {
  const raw = pathname.split("/").pop() || "captionmitra-result";
  const cleaned = raw.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  return cleaned || "captionmitra-result";
}

/**
 * Authenticate a customer download, fetch a private blob, and atomically record
 * the download only while the job is completed and its retention window is open.
 */
export async function getCustomerDownload(pool, getBlob, { jobId, accessToken }) {
  if (typeof jobId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error("Download not found");
  }
  if (typeof accessToken !== "string" || accessToken.length < 30 || accessToken.length > 100) {
    throw new Error("Invalid access key");
  }
  const tokenHash = createHash("sha256").update(accessToken, "utf8").digest("hex");
  const found = await pool.query(
    `SELECT id, result_blob_path
     FROM caption_jobs
     WHERE id = $1 AND customer_access_token_hash = $2
       AND status = 'completed' AND result_blob_path IS NOT NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [jobId, tokenHash]
  );
  const job = found.rows[0];
  if (!job) throw new Error("Download not found or expired");

  const blob = await getBlob(job.result_blob_path, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    throw new Error("Download file is unavailable");
  }

  const recorded = await pool.query(
    `UPDATE caption_jobs
     SET customer_last_downloaded_at = NOW(),
         customer_download_count = customer_download_count + 1,
         updated_at = NOW()
     WHERE id = $1 AND customer_access_token_hash = $2
       AND status = 'completed' AND result_blob_path = $3
       AND expires_at > NOW()
     RETURNING customer_download_count`,
    [jobId, tokenHash, job.result_blob_path]
  );
  if (!recorded.rows[0]) {
    try { await blob.stream.cancel(); } catch {}
    throw new Error("Download expired or access was revoked");
  }

  return {
    stream: blob.stream,
    contentType: blob.blob.contentType || "application/octet-stream",
    filename: safeFilename(blob.blob.pathname || job.result_blob_path),
    size: blob.blob.size,
    downloadCount: Number(recorded.rows[0].customer_download_count)
  };
}
