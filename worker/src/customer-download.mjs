import { get } from "@vercel/blob";
import { hashCustomerAccessToken, verifyCustomerAccessToken } from "./customer-access-token.mjs";

const MAX_RESULT_BYTES = 5 * 1024 * 1024;
const OUTPUT_FORMATS = {
  srt: { filename: "captions.srt", contentType: "application/x-subrip; charset=utf-8" },
  txt: { filename: "captions.txt", contentType: "text/plain; charset=utf-8" }
};

export async function downloadCustomerResult({ pool, blobToken, jobId, accessToken, format, getBlob = get } = {}) {
  if (!pool || typeof pool.query !== "function") throw new Error("A PostgreSQL pool is required");
  if (!blobToken) throw new Error("Blob read/write token is required");
  if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) throw new Error("Invalid job identifier");
  if (!Object.hasOwn(OUTPUT_FORMATS, format)) throw new Error("Unsupported download format");

  let tokenHash;
  try { tokenHash = hashCustomerAccessToken(accessToken); }
  catch { throw new Error("Invalid download credentials"); }

  const result = await pool.query(
    "SELECT status, result_blob_path, customer_access_token_hash, expires_at FROM caption_jobs WHERE id = $1 LIMIT 1",
    [jobId]
  );
  const job = result.rows[0];
  if (!job || job.status !== "completed" || !job.result_blob_path ||
      new Date(job.expires_at).getTime() <= Date.now() ||
      !verifyCustomerAccessToken(accessToken, job.customer_access_token_hash) ||
      tokenHash !== job.customer_access_token_hash) {
    throw new Error("Download is unavailable or the access link is invalid");
  }

  const blob = await getBlob(job.result_blob_path, { access: "private", token: blobToken });
  if (!blob || blob.statusCode !== 200 || !blob.stream ||
      (blob.blob?.size != null && blob.blob.size > MAX_RESULT_BYTES)) {
    throw new Error("Private caption result is unavailable");
  }
  const body = await new Response(blob.stream).text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESULT_BYTES) throw new Error("Caption result exceeds the download size limit");
  let payload;
  try { payload = JSON.parse(body); } catch { throw new Error("Stored caption result is invalid"); }
  if (payload?.version !== 1 || payload.jobId !== jobId ||
      !payload.files || typeof payload.files[format]?.content !== "string") {
    throw new Error("Stored caption file is invalid");
  }

  const metadata = OUTPUT_FORMATS[format];
  const content = payload.files[format].content;
  await pool.query(
    "UPDATE caption_jobs SET customer_last_downloaded_at = NOW(), customer_download_count = customer_download_count + 1 WHERE id = $1 AND status = 'completed'",
    [jobId]
  );
  return { content, filename: metadata.filename, contentType: metadata.contentType };
}
