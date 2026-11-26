import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyRazorpayWebhookSignature } from "./razorpay-webhook-signature.mjs";

const secret = "test-webhook-secret";
const raw = Buffer.from('{"event":"payment.captured","value":1}');
const sign = (body, key = secret) => createHmac("sha256", key).update(body).digest("hex");

test("accepts HMAC for exact raw body", () => {
  assert.equal(verifyRazorpayWebhookSignature(raw, sign(raw), secret), true);
});

test("rejects wrong signature", () => {
  assert.equal(verifyRazorpayWebhookSignature(raw, "0".repeat(64), secret), false);
});

test("rejects modified body", () => {
  assert.equal(verifyRazorpayWebhookSignature(Buffer.from(raw.toString().replace("1}", "2}")), sign(raw), secret), false);
});

test("rejects malformed signature", () => {
  for (const signature of ["", "xyz", "123", "g".repeat(64), "0".repeat(63), "0".repeat(65)]) {
    assert.equal(verifyRazorpayWebhookSignature(raw, signature, secret), false);
  }
});

test("rejects missing secret and invalid body input", () => {
  assert.equal(verifyRazorpayWebhookSignature(raw, sign(raw), ""), false);
  assert.equal(verifyRazorpayWebhookSignature({}, sign(raw), secret), false);
  assert.equal(verifyRazorpayWebhookSignature(raw, {}, secret), false);
});

test("signature is case insensitive hex", () => {
  assert.equal(verifyRazorpayWebhookSignature(raw, sign(raw).toUpperCase(), secret), true);
});
