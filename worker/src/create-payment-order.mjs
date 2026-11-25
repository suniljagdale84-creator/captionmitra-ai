/**
 * Create a Razorpay order only from the server-verified amount stored on the job.
 * The gateway adapter is injected so unit tests never contact Razorpay.
 */
export async function createPaymentOrder(pool, jobId, gateway) {
  if (typeof jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    throw new Error("Invalid job identifier");
  }
  if (!gateway || typeof gateway.createOrder !== "function") {
    throw new Error("Payment gateway is not configured");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const selected = await client.query(
      `SELECT id, status, amount_paise, currency, provider_order_id
       FROM caption_jobs
       WHERE id = $1
       FOR UPDATE`,
      [jobId]
    );
    const job = selected.rows[0];
    if (!job) throw new Error("Job not found");

    if (job.provider_order_id) {
      await client.query("COMMIT");
      return {
        orderId: job.provider_order_id,
        amountPaise: Number(job.amount_paise),
        currency: job.currency,
        reused: true
      };
    }

    if (job.status !== "awaiting_payment" ||
        !Number.isSafeInteger(Number(job.amount_paise)) ||
        Number(job.amount_paise) < 1000) {
      throw new Error("Job is not eligible for payment");
    }

    const amountPaise = Number(job.amount_paise);
    const order = await gateway.createOrder({
      amount: amountPaise,
      currency: job.currency || "INR",
      receipt: job.id
    });

    if (!order || typeof order.id !== "string" ||
        order.amount !== amountPaise ||
        order.currency !== (job.currency || "INR")) {
      throw new Error("Payment gateway returned an invalid order");
    }

    await client.query(
      `UPDATE caption_jobs
       SET payment_provider = 'razorpay',
           provider_order_id = $2,
           updated_at = NOW()
       WHERE id = $1 AND status = 'awaiting_payment'`,
      [jobId, order.id]
    );

    await client.query("COMMIT");
    return {
      orderId: order.id,
      amountPaise,
      currency: order.currency,
      reused: false
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
