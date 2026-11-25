import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyRazorpayWebhookSignature,
  verifyRazorpayCheckoutSignature,
  applyRazorpayCapturedEvent
} from "../src/razorpay-verification.mjs";

const secret = "test-webhook-secret";
const raw = Buffer.from(JSON.stringify({ event: "payment.captured" }));
const sign = (body, key) => createHmac("sha256", key).update(body).digest("hex");

test("verifies webhook signature against raw bytes", () => {
  assert.equal(verifyRazorpayWebhookSignature(raw, sign(raw, secret), secret), true);
  assert.equal(verifyRazorpayWebhookSignature(raw, "0".repeat(64), secret), false);
  assert.equal(verifyRazorpayWebhookSignature("not-buffer", sign(raw, secret), secret), false);
});

test("verifies checkout signature in order_id|payment_id format", () => {
  const message = "order_123|pay_456";
  assert.equal(verifyRazorpayCheckoutSignature("order_123", "pay_456", sign(message, "key-secret"), "key-secret"), true);
  assert.equal(verifyRazorpayCheckoutSignature("order_123", "pay_456", "0".repeat(64), "key-secret"), false);
});

function fakePool({ existingEvent = false, jobStatus = "awaiting_payment", amount = 1500 } = {}) {
  const calls = [];
  const client = { query: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.includes("INSERT INTO payment_webhook_events")) return { rows: existingEvent ? [] : [{ provider_event_id: "evt_1" }] };
    if (sql.includes("SELECT id, status")) return { rows: [{ id: "job_1", status: jobStatus, amount_paise: amount, currency: "INR", provider_order_id: "order_1", provider_payment_id: null }] };
    return { rows: [] };
  }, release() {} };
  return { calls, connect: async () => client };
}
const payload = { event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 1500, currency: "INR" } } } };

test("captured payment atomically queues a matching paid job", async () => {
  const pool = fakePool();
  const body = Buffer.from(JSON.stringify(payload));
  const result = await applyRazorpayCapturedEvent(pool, { rawBody: body, signature: sign(body, secret), webhookSecret: secret, eventId: "evt_1", payload });
  assert.equal(result.queued, true);
  assert.ok(pool.calls.some(c => c.sql?.includes("SET status = 'queued'")));
  assert.ok(pool.calls.some(c => c.sql === "COMMIT"));
});

test("duplicate webhook event does not queue twice", async () => {
  const pool = fakePool({ existingEvent: true });
  const body = Buffer.from(JSON.stringify(payload));
  const result = await applyRazorpayCapturedEvent(pool, { rawBody: body, signature: sign(body, secret), webhookSecret: secret, eventId: "evt_1", payload });
  assert.equal(result.duplicate, true);
  assert.equal(pool.calls.some(c => c.sql?.includes("SET status = 'queued'")), false);
});

test("rejects amount mismatch and rolls back", async () => {
  const pool = fakePool({ amount: 1400 });
  const body = Buffer.from(JSON.stringify(payload));
  await assert.rejects(applyRazorpayCapturedEvent(pool, { rawBody: body, signature: sign(body, secret), webhookSecret: secret, eventId: "evt_1", payload }), /mismatch/);
  assert.ok(pool.calls.some(c => c.sql === "ROLLBACK"));
});
