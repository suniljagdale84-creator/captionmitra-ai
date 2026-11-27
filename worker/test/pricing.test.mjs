import test from "node:test";
import assert from "node:assert/strict";
import { calculatePricePaise, calculatePriceRupees } from "../src/pricing.mjs";

test("applies the ₹10 minimum to short videos", () => {
  assert.equal(calculatePricePaise(30), 1000);
  assert.equal(calculatePricePaise(60), 1000);
  assert.equal(calculatePriceRupees(180), 10);
});

test("uses exact-duration prorata above the minimum", () => {
  assert.equal(calculatePricePaise(240), 1200);
  assert.equal(calculatePricePaise(241), 1205);
  assert.equal(calculatePricePaise(600), 3000);
});

test("rounds fractional paise upward without rounding to a full minute", () => {
  assert.equal(calculatePricePaise(240.01), 1201);
  assert.equal(calculatePricePaise(240.2), 1201);
});

test("rejects invalid or unsupported durations", () => {
  for (const value of [0, -1, NaN, Infinity, "240", null, 10800.001]) {
    assert.throws(() => calculatePricePaise(value), /Invalid media duration/);
  }
});
