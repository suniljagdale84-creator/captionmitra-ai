import { createHash, randomBytes } from "node:crypto";
import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ALLOWED_LANGUAGES = new Set(["Hindi", "Marathi", "English", "Hinglish"]);
const ALLOWED_CONTENT_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/x-matroska", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/flac", "audio/webm"]);

type JobRequest = { pathname?: unknown; language?: unknown; idempotencyKey?: unknown; turnstileToken?: unknown };

declare global { var captionMitraPool: Pool | undefined; }

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured.");
  if (!globalThis.captionMitraPool) globalThis.captionMitraPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000, statement_timeout: 8000, application_name: "captionmitra-web" });
  return globalThis.captionMitraPool;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function verifyTurnstile(token: string, request: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token, remoteip: ip })
  });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}

export async function POST(request: Request) {
  let client;
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "Private file storage is not configured." }, { status: 503 });
    const body = (await request.json()) as JobRequest;
    if (typeof body.pathname !== "string" || !/^incoming\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,139}$/.test(body.pathname) || typeof body.language !== "string" || !ALLOWED_LANGUAGES.has(body.language) || !isUuid(body.idempotencyKey) || typeof body.turnstileToken !== "string" || body.turnstileToken.length < 10) {
      return NextResponse.json({ error: "Invalid job request." }, { status: 400 });
    }

    if (!(await verifyTurnstile(body.turnstileToken, request))) return NextResponse.json({ error: "Security verification failed. Please try again." }, { status: 403 });

    // Verify actual private Blob metadata; browser-provided size and MIME are not trusted.
    const metadata = await head(body.pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
    if (metadata.pathname !== body.pathname || !Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > MAX_FILE_SIZE || !ALLOWED_CONTENT_TYPES.has(metadata.contentType)) {
      return NextResponse.json({ error: "Uploaded file is not supported or exceeds 200 MB." }, { status: 400 });
    }

    const customerAccessToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(customerAccessToken, "utf8").digest("hex");
    const pool = getPool();
    client = await pool.connect();
    await client.query("BEGIN");

    const inserted = await client.query(
      "INSERT INTO caption_jobs (idempotency_key, source_blob_path, source_size_bytes, source_content_type, output_language, status, customer_access_token_hash, customer_access_token_created_at) VALUES ($1, $2, $3, $4, $5, 'awaiting_payment', $6, NOW()) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, status",
      [body.idempotencyKey, metadata.pathname, metadata.size, metadata.contentType, body.language, tokenHash]
    );

    let job = inserted.rows[0];
    if (!job) {
      const existing = await client.query("SELECT id, status, source_blob_path, output_language FROM caption_jobs WHERE idempotency_key = $1 FOR UPDATE", [body.idempotencyKey]);
      const row = existing.rows[0];
      if (!row || row.source_blob_path !== metadata.pathname || row.output_language !== body.language) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "This upload request key was already used for a different job." }, { status: 409 });
      }
      // Reissue a fresh one-time secret on a legitimate retry; the previous token is invalidated.
      const rotated = await client.query("UPDATE caption_jobs SET customer_access_token_hash = $2, customer_access_token_created_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, status", [row.id, tokenHash]);
      job = rotated.rows[0];
    } else {
      await client.query("INSERT INTO caption_job_events (job_id, from_status, to_status, event_code) VALUES ($1, NULL, 'awaiting_payment', 'upload_verified_job_created')", [job.id]);
    }

    // Queue server-side FFprobe inspection before a payment order can be created.
    // The browser's media.duration is display-only and is never used for billing.
    await client.query(
      "INSERT INTO caption_media_inspections (job_id) VALUES ($1) ON CONFLICT (job_id) DO NOTHING",
      [job.id]
    );

    await client.query("COMMIT");
    return NextResponse.json({ jobId: job.id, status: job.status, inspectionStatus: "pending", customerAccessToken, message: "Upload verified. Server-side media inspection is queued before payment." }, { status: inserted.rows[0] ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("not found") || message.includes("Blob") ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? "Uploaded file could not be verified." : "Could not create the processing job." }, { status, headers: { "Cache-Control": "no-store" } });
  } finally {
    client?.release();
  }
}
