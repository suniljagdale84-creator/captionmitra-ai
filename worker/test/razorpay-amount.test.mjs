import test from "node:test";
import assert from "node:assert/strict";
import { razorpayAmountMatches } from "../../src/lib/razorpay-amount.mjs";

test("matches PostgreSQL BIGINT string with Razorpay integer paise", () => {
  assert.equal(razorpayAmountMatches("1200", 1200), true);
});

test("rejects mismatched, unsafe and malformed payment amounts", () => {
  assert.equal(razorpayAmountMatches("1201", 1200), false);
  assert.equal(razorpayAmountMatches("12x0", 1200), false);
  assert.equal(razorpayAmountMatches("9007199254740992", 9007199254740992), false);
  assert.equal(razorpayAmountMatches(1200, "1200"), false);
});
