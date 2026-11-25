import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof secret !== "string" || !secret ||
      typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * Persist a verified failed-payment event. A failed payment never queues work.
 */
export async function applyRazorpayPaymentFailedEvent(pool, {
  rawBody, signature, webhookSecret, eventId, payload
}) {
  if (!verify(rawBody, signature, webhookSecret)) throw new Error("Invalid Razorpay webhook signature");
  if (!eventId || payload?.event !== "payment.failed") throw new Error("Unsupported payment event");
  const payment = payload.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id) throw new Error("Invalid failed payment details");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO payment_webhook_events (provider, provider_event_id, payload_sha256)
       VALUES ('razorpay', $1, encode(digest($2, 'sha256'), 'hex'))
       ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING provider_event_id`,
      [eventId, rawBody]
    );
    if (!inserted.rows.length) {
      await client.query("COMMIT");
      return { duplicate: true, updated: false };
    }
    const found = await client.query(
      `SELECT id, status FROM caption_jobs WHERE provider_order_id = $1 FOR UPDATE`,
      [payment.order_id]
    );
    if (!found.rows[0]) throw new Error("Payment order does not match a job");
    const job = found.rows[0];
    let updated = false;
    if (job.status === "awaiting_payment") {
      await client.query(
        `UPDATE caption_jobs SET status = 'payment_failed', error_code = 'razorpay_payment_failed',
         updated_at = NOW() WHERE id = $1 AND status = 'awaiting_payment'`,
        [job.id]
      );
      await client.query(
        `INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
         VALUES ($1, 'awaiting_payment', 'payment_failed', 'razorpay_payment_failed')`,
        [job.id]
      );
      updated = true;
    }
    await client.query(
      `UPDATE payment_webhook_events SET processed_at = NOW()
       WHERE provider = 'razorpay' AND provider_event_id = $1`, [eventId]
    );
    await client.query("COMMIT");
    return { duplicate: false, updated };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally { client.release(); }
}

/**
 * Record only a full refund confirmed by Razorpay's refund.processed event.
 * This function does not initiate refunds and never trusts client-supplied status.
 */
export async function applyRazorpayRefundProcessedEvent(pool, {
  rawBody, signature, webhookSecret, eventId, payload
}) {
  if (!verify(rawBody, signature, webhookSecret)) throw new Error("Invalid Razorpay webhook signature");
  if (!eventId || payload?.event !== "refund.processed") throw new Error("Unsupported refund event");
  const refund = payload.payload?.refund?.entity;
  if (!refund?.id || !refund?.payment_id ||
      !Number.isSafeInteger(refund.amount) || refund.amount <= 0 || refund.currency !== "INR") {
    throw new Error("Invalid refund details");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO payment_webhook_events (provider, provider_event_id, payload_sha256)
       VALUES ('razorpay', $1, encode(digest($2, 'sha256'), 'hex'))
       ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING provider_event_id`,
      [eventId, rawBody]
    );
    if (!inserted.rows.length) {
      await client.query("COMMIT");
      return { duplicate: true, refunded: false };
    }
    const found = await client.query(
      `SELECT id, status, amount_paise, provider_payment_id, provider_refund_id
       FROM caption_jobs WHERE provider_payment_id = $1 FOR UPDATE`,
      [refund.payment_id]
    );
    const job = found.rows[0];
    if (!job) throw new Error("Refund payment does not match a job");
    if (Number(job.amount_paise) !== refund.amount) {
      throw new Error("Partial refunds are not supported by this handler");
    }
    if (job.provider_refund_id === refund.id && job.status === "refunded") {
      await client.query("COMMIT");
      return { duplicate: true, refunded: false };
    }
    if (!["paid", "queued", "processing", "completed", "processing_failed"].includes(job.status) ||
        job.provider_refund_id) throw new Error("Job is not eligible for refund recording");

    await client.query(
      `UPDATE caption_jobs SET status = 'refunded', provider_refund_id = $2,
       refunded_amount_paise = $3, refunded_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [job.id, refund.id, refund.amount]
    );
    await client.query(
      `INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
       VALUES ($1, $2::caption_job_status, 'refunded', 'razorpay_refund_processed')`,
      [job.id, job.status]
    );
    await client.query(
      `UPDATE payment_webhook_events SET processed_at = NOW()
       WHERE provider = 'razorpay' AND provider_event_id = $1`, [eventId]
    );
    await client.query("COMMIT");
    return { duplicate: false, refunded: true, jobId: job.id };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally { client.release(); }
}
