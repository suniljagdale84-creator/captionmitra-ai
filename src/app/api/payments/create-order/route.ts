import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
declare global { var captionMitraPaymentPool: Pool | undefined; }

function pool() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured");
  if (!globalThis.captionMitraPaymentPool) globalThis.captionMitraPaymentPool = new Pool({
    connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000, statement_timeout: 15000, application_name: "captionmitra-payment"
  });
  return globalThis.captionMitraPaymentPool;
}
function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex"), right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
function authHeader(keyId: string, keySecret: string) {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

export async function POST(request: Request) {
  let client;
  let transaction = false;
  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) return NextResponse.json({ error: "Payment setup is not enabled yet." }, { status: 503 });
    const body = await request.json() as { jobId?: unknown; customerAccessToken?: unknown };
    if (typeof body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.jobId) || !validToken(body.customerAccessToken)) {
      return NextResponse.json({ error: "Invalid payment request." }, { status: 400 });
    }

    const tokenHash = createHash("sha256").update(body.customerAccessToken).digest("hex");
    client = await pool().connect();
    await client.query("BEGIN");
    transaction = true;
    const found = await client.query(
      "SELECT id, status, media_duration_seconds, provider_order_id, customer_access_token_hash FROM caption_jobs WHERE id = $1 FOR UPDATE",
      [body.jobId]
    );
    const job = found.rows[0];
    if (!job || !job.customer_access_token_hash || !safeEqualHex(tokenHash, job.customer_access_token_hash)) {
      await client.query("ROLLBACK"); transaction = false;
      return NextResponse.json({ error: "Job or customer access credential is invalid." }, { status: 404 });
    }
    if (job.status !== "awaiting_payment") {
      await client.query("ROLLBACK"); transaction = false;
      return NextResponse.json({ error: "This job is not awaiting payment." }, { status: 409 });
    }
    if (!job.media_duration_seconds || Number(job.media_duration_seconds) <= 0) {
      await client.query("ROLLBACK"); transaction = false;
      return NextResponse.json({ error: "Video duration must be measured by the processing worker before payment." }, { status: 409 });
    }

    const roundingMode = process.env.BILLING_ROUNDING_MODE;
    if (roundingMode !== "ceil_minute" && roundingMode !== "pro_rata") {
      await client.query("ROLLBACK"); transaction = false;
      return NextResponse.json({ error: "Payment is paused until the partial-minute billing rule is confirmed." }, { status: 503 });
    }
    const durationSeconds = Number(job.media_duration_seconds);
    const amountPaise = roundingMode === "ceil_minute"
      ? Math.max(1000, Math.ceil(durationSeconds / 60) * 300)
      : Math.max(1000, Math.ceil(durationSeconds * 5));
    if (!Number.isSafeInteger(amountPaise)) {
      await client.query("ROLLBACK"); transaction = false;
      return NextResponse.json({ error: "Calculated amount is invalid." }, { status: 400 });
    }

    const authorization = authHeader(keyId, keySecret);
    if (job.provider_order_id) {
      const existing = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(job.provider_order_id)}`, {
        headers: { Authorization: authorization }, cache: "no-store"
      });
      if (!existing.ok) throw new Error("Could not verify existing payment order");
      const order = await existing.json() as { id: string; amount: number; currency: string };
      if (order.amount !== amountPaise || order.currency !== "INR") throw new Error("Existing payment order amount does not match job price");
      await client.query("COMMIT"); transaction = false;
      return NextResponse.json({ orderId: order.id, amountPaise, currency: "INR", keyId }, { headers: { "Cache-Control": "no-store" } });
    }

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountPaise, currency: "INR",
        receipt: `cm_${String(job.id).replaceAll("-", "").slice(0, 32)}`,
        notes: { captionmitra_job_id: job.id }
      }),
      cache: "no-store"
    });
    const data = await response.json() as { id?: string; amount?: number; currency?: string };
    if (!response.ok || !data.id || data.amount !== amountPaise || data.currency !== "INR") {
      throw new Error("Payment provider could not create a matching order");
    }

    await client.query(
      "UPDATE caption_jobs SET amount_paise = $2, currency = 'INR', payment_provider = 'razorpay', provider_order_id = $3, updated_at = NOW() WHERE id = $1",
      [job.id, amountPaise, data.id]
    );
    await client.query("COMMIT"); transaction = false;
    return NextResponse.json({ orderId: data.id, amountPaise, currency: "INR", keyId }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    if (client && transaction) await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: "Could not prepare payment. Please try again." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  } finally {
    client?.release();
  }
}
