import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

declare global { var captionMitraWebhookPool: Pool | undefined; }
function pool() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured");
  if (!globalThis.captionMitraWebhookPool) globalThis.captionMitraWebhookPool = new Pool({
    connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000, statement_timeout: 8000, application_name: "captionmitra-webhook"
  });
  return globalThis.captionMitraWebhookPool;
}
function validSignature(raw: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "hex"), b = Buffer.from(signature, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  const signature = request.headers.get("x-razorpay-signature") || "";
  const eventId = request.headers.get("x-razorpay-event-id") || "";
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId) || !validSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 }); }
  if (payload?.event === "payment.failed") {
    const failedPayment = payload?.payload?.payment?.entity;
    if (!failedPayment || typeof failedPayment.id !== "string" ||
        typeof failedPayment.order_id !== "string" || failedPayment.status !== "failed") {
      return NextResponse.json({ error: "Invalid failed payment details." }, { status: 400 });
    }
    const digest = createHash("sha256").update(raw).digest("hex");
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        "INSERT INTO payment_webhook_events (provider, provider_event_id, payload_sha256) VALUES ('razorpay', $1, $2) ON CONFLICT DO NOTHING RETURNING provider_event_id",
        [eventId, digest]
      );
      if (!inserted.rowCount) {
        const prior = await client.query(
          "SELECT payload_sha256 FROM payment_webhook_events WHERE provider = 'razorpay' AND provider_event_id = $1",
          [eventId]
        );
        if (prior.rows[0]?.payload_sha256 !== digest) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Webhook event identifier was reused with a different payload." }, { status: 409 });
        }
        await client.query("COMMIT");
        return NextResponse.json({ received: true, duplicate: true });
      }
      const found = await client.query(
        "SELECT id, status FROM caption_jobs WHERE provider_order_id = $1 FOR UPDATE",
        [failedPayment.order_id]
      );
      const job = found.rows[0];
      if (job?.status === "awaiting_payment") {
        await client.query(
          "UPDATE caption_jobs SET payment_attempt_status = 'failed', error_code = 'razorpay_payment_failed', updated_at = NOW() WHERE id = $1 AND status = 'awaiting_payment'",
          [job.id]
        );
        await client.query(
          "INSERT INTO caption_job_events (job_id, from_status, to_status, event_code) VALUES ($1, 'awaiting_payment', 'awaiting_payment', 'razorpay_payment_failed')",
          [job.id]
        );
      }
      await client.query(
        "UPDATE payment_webhook_events SET processed_at = NOW(), processing_error_code = $2 WHERE provider = 'razorpay' AND provider_event_id = $1",
        [eventId, job ? null : "order_not_found"]
      );
      await client.query("COMMIT");
      return NextResponse.json({ received: true });
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      return NextResponse.json({ error: "Webhook processing failed; provider may retry." }, { status: 500 });
    } finally { client.release(); }
  }
  if (payload?.event !== "payment.captured") return NextResponse.json({ received: true });

  const payment = payload?.payload?.payment?.entity;
  if (!payment || typeof payment.id !== "string" || typeof payment.order_id !== "string" ||
      !Number.isSafeInteger(payment.amount) || payment.currency !== "INR" || payment.status !== "captured") {
    return NextResponse.json({ error: "Invalid captured payment details." }, { status: 400 });
  }

  const digest = createHash("sha256").update(raw).digest("hex");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const event = await client.query(
      "INSERT INTO payment_webhook_events (provider, provider_event_id, payload_sha256) VALUES ('razorpay', $1, $2) ON CONFLICT DO NOTHING RETURNING provider_event_id",
      [eventId, digest]
    );
    if (!event.rowCount) {
      const prior = await client.query(
        "SELECT payload_sha256 FROM payment_webhook_events WHERE provider = 'razorpay' AND provider_event_id = $1",
        [eventId]
      );
      const priorDigest = prior.rows[0]?.payload_sha256;
      if (typeof priorDigest !== "string" || priorDigest !== digest) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Webhook event identifier was reused with a different payload." }, { status: 409 });
      }
      await client.query("COMMIT");
      return NextResponse.json({ received: true, duplicate: true });
    }

    const result = await client.query(
      "SELECT id, status, amount_paise, currency, provider_payment_id FROM caption_jobs WHERE provider_order_id = $1 FOR UPDATE",
      [payment.order_id]
    );
    const job = result.rows[0];
    if (!job || job.amount_paise !== payment.amount || job.currency !== "INR" || !["awaiting_payment", "paid", "queued", "processing", "completed"].includes(job.status)) {
      await client.query("UPDATE payment_webhook_events SET processing_error_code = 'order_or_amount_mismatch', processed_at = NOW() WHERE provider = 'razorpay' AND provider_event_id = $1", [eventId]);
      await client.query("COMMIT");
      return NextResponse.json({ received: true, reviewed: true });
    }

    if (job.provider_payment_id && job.provider_payment_id !== payment.id) {
      await client.query("UPDATE payment_webhook_events SET processing_error_code = 'payment_id_conflict', processed_at = NOW() WHERE provider = 'razorpay' AND provider_event_id = $1", [eventId]);
      await client.query("COMMIT");
      return NextResponse.json({ received: true, reviewed: true });
    }

    if (job.status === "awaiting_payment") {
      await client.query(
        "UPDATE caption_jobs SET status = 'queued', provider_payment_id = $2, payment_verified_at = NOW(), updated_at = NOW(), available_at = NOW() WHERE id = $1",
        [job.id, payment.id]
      );
      await client.query(
        "INSERT INTO caption_job_events (job_id, from_status, to_status, event_code) VALUES ($1, 'awaiting_payment', 'queued', 'razorpay_payment_captured')",
        [job.id]
      );
    }
    await client.query("UPDATE payment_webhook_events SET processed_at = NOW() WHERE provider = 'razorpay' AND provider_event_id = $1", [eventId]);
    await client.query("COMMIT");
    return NextResponse.json({ received: true });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: "Webhook processing failed; provider may retry." }, { status: 500 });
  } finally {
    client.release();
  }
}
