import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidCapturedPayment,
  isValidFailedPayment,
  isValidRefund
} from "./razorpay-event-validation.mjs";

test("accepts only captured INR payments with safe positive integer amounts", () => {
  const valid = { id: "pay_1", order_id: "order_1", amount: 1500, currency: "INR", status: "captured" };
  assert.equal(isValidCapturedPayment(valid), true);
  for (const patch of [
    { amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: Number.MAX_SAFE_INTEGER + 1 },
    { currency: "USD" }, { status: "authorized" }, { id: "" }, { order_id: "" }
  ]) assert.equal(isValidCapturedPayment({ ...valid, ...patch }), false);
  assert.equal(isValidCapturedPayment(null), false);
});

test("accepts failed payment only with required provider identifiers and failed status", () => {
  const valid = { id: "pay_1", order_id: "order_1", status: "failed" };
  assert.equal(isValidFailedPayment(valid), true);
  assert.equal(isValidFailedPayment({ ...valid, status: "captured" }), false);
  assert.equal(isValidFailedPayment({ ...valid, id: "" }), false);
  assert.equal(isValidFailedPayment({ ...valid, order_id: "" }), false);
});

test("validates refund status, payment identity, currency and integer amount", () => {
  const valid = { id: "rfnd_1", payment_id: "pay_1", amount: 500, currency: "INR", status: "processed" };
  assert.equal(isValidRefund(valid, "processed"), true);
  assert.equal(isValidRefund({ ...valid, status: "failed" }, "processed"), false);
  assert.equal(isValidRefund({ ...valid, amount: 0 }, "processed"), false);
  assert.equal(isValidRefund({ ...valid, amount: 1.2 }, "processed"), false);
  assert.equal(isValidRefund({ ...valid, currency: "USD" }, "processed"), false);
  assert.equal(isValidRefund({ ...valid, payment_id: "" }, "processed"), false);
  assert.equal(isValidRefund(valid, "unknown"), false);
});
