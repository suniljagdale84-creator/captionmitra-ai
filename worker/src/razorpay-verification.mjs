import { createHmac, timingSafeEqual, createHash } from "node:crypto";

function safeHexEqual(expected, supplied) {
  if (typeof supplied !== "string" || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(supplied, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verify Razorpay webhook signature against the exact raw request bytes. */
export function verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret) {
  if (!Buffer.isBuffer(rawBody) || !webhookSecret || typeof signature !== "string") return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeHexEqual(expected, signature);
}

/** Verify the checkout callback signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyRazorpayCheckoutSignature(orderId, paymentId, signature, keySecret) {
  if (![orderId, paymentId, signature, keySecret].every(v => typeof v === "string" && v.length > 0)) return false;
  const expected = createHmac("sha256", keySecret).update(orderId + "|" + paymentId).digest("hex");
  return safeHexEqual(expected, signature);
}

/**
 * Apply only a captured, amount-matching payment. The webhook event ID is
 * unique in PostgreSQL, making retries idempotent. Queueing occurs in the
 * same DB transaction as the verified paid-state transition.
 */
export async function applyRazorpayCapturedEvent(pool, {
  rawBody, signature, webhookSecret, eventId, payload
}) {
  if (!verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret)) {
    throw new Error("Invalid Razorpay webhook signature");
  }
  if (typeof eventId !== "string" || !eventId || !payload || payload.event !== "payment.captured") {
    throw new Error("Unsupported or invalid payment event");
  }

  const payment = payload.payload?.payment?.entity;
  if (!payment || typeof payment.id !== "string" ||
      typeof payment.order_id !== "string" ||
      !Number.isSafeInteger(payment.amount) ||
      payment.amount < 1000 || payment.currency !== "INR") {
    throw new Error("Invalid captured payment details");
  }

  const digest = createHash("sha256").update(rawBody).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO payment_webhook_events
       (provider, provider_event_id, payload_sha256)
       VALUES ('razorpay', $1, $2)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING provider_event_id`,
      [eventId, digest]
    );

    if (!inserted.rows.length) {
      await client.query("COMMIT");
      return { duplicate: true, queued: false };
    }

    const selected = await client.query(
      `SELECT id, status, amount_paise, currency, provider_order_id, provider_payment_id
       FROM caption_jobs WHERE provider_order_id = $1 FOR UPDATE`,
      [payment.order_id]
    );
    const job = selected.rows[0];
    if (!job) throw new Error("Payment order does not match a job");
    if (Number(job.amount_paise) !== payment.amount || job.currency !== payment.currency) {
      throw new Error("Captured payment amount or currency mismatch");
    }

    if (job.provider_payment_id === payment.id &&
        ["paid", "queued", "processing", "completed"].includes(job.status)) {
      await client.query("COMMIT");
      return { duplicate: true, queued: false };
    }
    if (job.status !== "awaiting_payment" || job.provider_payment_id) {
      throw new Error("Job is not eligible for captured payment");
    }

    await client.query(
      `UPDATE caption_jobs
       SET status = 'queued', provider_payment_id = $2,
           payment_verified_at = NOW(), updated_at = NOW(),
           available_at = NOW()
       WHERE id = $1 AND status = 'awaiting_payment'`,
      [job.id, payment.id]
    );
    await client.query(
      `INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
       VALUES ($1, 'awaiting_payment', 'queued', 'razorpay_payment_captured')`,
      [job.id]
    );
    await client.query(
      `UPDATE payment_webhook_events
       SET processed_at = NOW() WHERE provider = 'razorpay' AND provider_event_id = $1`,
      [eventId]
    );
    await client.query("COMMIT");
    return { duplicate: false, queued: true, jobId: job.id };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
