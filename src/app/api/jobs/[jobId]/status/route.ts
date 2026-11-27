import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
declare global { var captionMitraStatusPool: Pool | undefined; }

function pool() {
  if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
  if (!globalThis.captionMitraStatusPool) globalThis.captionMitraStatusPool = new Pool({
    connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000, statement_timeout: 5000, application_name: "captionmitra-status"
  });
  return globalThis.captionMitraStatusPool;
}

export async function POST(request: Request, context: { params: { jobId: string } }) {
  try {
    const { jobId } = context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    const body = await request.json() as { customerAccessToken?: unknown };
    if (typeof body.customerAccessToken !== "string" || body.customerAccessToken.length < 30 || body.customerAccessToken.length > 100) {
      return NextResponse.json({ error: "Invalid access key." }, { status: 401 });
    }
    const hash = createHash("sha256").update(body.customerAccessToken, "utf8").digest("hex");
    const result = await pool().query(
      `SELECT id, status, output_language, media_duration_seconds, amount_paise,
              currency, created_at, updated_at, expires_at, result_blob_path
       FROM caption_jobs
       WHERE id = $1 AND customer_access_token_hash = $2
       LIMIT 1`,
      [jobId, hash]
    );
    const job = result.rows[0];
    if (!job) return NextResponse.json({ error: "Job not found or access key is invalid." }, { status: 404 });
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      outputLanguage: job.output_language,
      durationSeconds: job.media_duration_seconds === null ? null : Number(job.media_duration_seconds),
      amountPaise: job.amount_paise === null ? null : Number(job.amount_paise),
      currency: job.currency,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      expiresAt: job.expires_at,
      downloadReady: Boolean(job.result_blob_path) && job.status === "completed"
    }, { headers: { "Cache-Control": "no-store, private", "Pragma": "no-cache" } });
  } catch {
    return NextResponse.json({ error: "Could not retrieve job status." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
