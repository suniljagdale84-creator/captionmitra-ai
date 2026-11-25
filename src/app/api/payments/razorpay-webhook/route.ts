import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { readLimitedBody } from "@/lib/read-limited-body.mjs";
import { razorpayAmountMatches } from "@/lib/razorpay-amount.mjs";

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
  let raw: string;
  try {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    raw = await readLimitedBody(request.body, 1024 * 1024);
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid webhook body." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId) || !validSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 }); }
  if (payload?.event === "refund.processed" || payload?.event === "refund.failed") {
    const refund = payload?.payload?.refund?.entity;
    const expectedRefundStatus = payload.event === "refund.processed" ? "processed" : "failed";
    if (!refund || typeof refund.id !== "string" ||
        typeof refund.payment_id !== "string" ||
        !Number.isSafeInteger(refund.amount) || refund.amount <= 0 ||
        refund.currency !== "INR" ||
        refund.status !== expectedRefundStatus) {
      return NextResponse.json({ error: "Invalid refund details." }, { status: 400 });
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
        "SELECT id, amount_paise, refunded_amount_paise, refund_status FROM caption_jobs WHERE provider_payment_id = $1 FOR UPDATE",
        [refund.payment_id]
      );
      const job = found.rows[0];
      if (!job) {
        await client.query(
          "UPDATE payment_webhook_events SET processed_at = NOW(), processing_error_code = 'payment_not_found' WHERE provider = 'razorpay' AND provider_event_id = $1",
          [eventId]
        );
        await client.query("COMMIT");
        return NextResponse.json({ received: true, reviewed: true });
      }

      const refundRecord = await client.query(
        "SELECT amount_paise, currency, status, provider_payment_id FROM caption_payment_refunds WHERE provider = 'razorpay' AND provider_refund_id = $1 FOR UPDATE",
        [refund.id]
      );
      const priorRefund = refundRecord.rows[0];
      if (priorRefund && (
        Number(priorRefund.amount_paise) !== refund.amount ||
        priorRefund.currency !== "INR" ||
        priorRefund.provider_payment_id !== refund.payment_id
      )) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Refund identifier was reused with different payment details." }, { status: 409 });
      }
      if (priorRefund?.status === "processed" && refund.status !== "processed") {
        await client.query("COMMIT");
        return NextResponse.json({ received: true, stale: true });
      }

      if (!priorRefund) {
        await client.query(
          "INSERT INTO caption_payment_refunds (job_id, provider_refund_id, provider_payment_id, amount_paise, currency, status) VALUES ($1, $2, $3, $4, 'INR', $5)",
          [job.id, refund.id, refund.payment_id, refund.amount, refund.status]
        );
      } else {
        await client.query(
          "UPDATE caption_payment_refunds SET status = $2, updated_at = NOW() WHERE provider = 'razorpay' AND provider_refund_id = $1",
          [refund.id, refund.status]
        );
      }

      const totals = await client.query(
        "SELECT COALESCE(SUM(amount_paise) FILTER (WHERE status = 'processed'), 0)::bigint AS processed_paise FROM caption_payment_refunds WHERE job_id = $1",
        [job.id]
      );
      const totalRefunded = Number(totals.rows[0]?.processed_paise || 0);
      if (!Number.isSafeInteger(totalRefunded) || totalRefunded > Number(job.amount_paise)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Refund total exceeds captured payment; manual review required." }, { status: 409 });
      }
      const refundStatus = totalRefunded === 0
        ? (refund.status === "failed" ? "failed" : "refund_pending")
        : totalRefunded >= Number(job.amount_paise) ? "refunded" : "partially_refunded";
      await client.query(
        "UPDATE caption_jobs SET refund_status = $2, refunded_amount_paise = $3, refunded_at = CASE WHEN $3 > 0 THEN NOW() ELSE refunded_at END, updated_at = NOW() WHERE id = $1",
        [job.id, refundStatus, totalRefunded]
      );
      await client.query(
        "UPDATE payment_webhook_events SET processed_at = NOW() WHERE provider = 'razorpay' AND provider_event_id = $1",
        [eventId]
      );
      await client.query("COMMIT");
      return NextResponse.json({ received: true, refundStatus, refundedAmountPaise: totalRefunded });
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      return NextResponse.json({ error: "Refund webhook processing failed; provider may retry." }, { status: 500 });
    } finally { client.release(); }
  }
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
    if (!job || !razorpayAmountMatches(job.amount_paise, payment.amount) || job.currency !== "INR" || !["awaiting_payment", "paid", "queued", "processing", "completed"].includes(job.status)) {
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
