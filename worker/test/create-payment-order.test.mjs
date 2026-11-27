import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentOrder } from "../src/create-payment-order.mjs";

function fakePool(job) {
  const calls = [];
  const client = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes("SELECT id, status")) return { rows: job ? [job] : [] };
      return { rows: [] };
    },
    release: () => calls.push({ released: true })
  };
  return { calls, connect: async () => client };
}

const id = "123e4567-e89b-12d3-a456-426614174000";

test("creates Razorpay order using only verified DB amount", async () => {
  const pool = fakePool({ id, status: "awaiting_payment", amount_paise: 1650, currency: "INR", provider_order_id: null });
  let payload;
  const result = await createPaymentOrder(pool, id, {
    createOrder: async input => { payload = input; return { id: "order_123", amount: 1650, currency: "INR" }; }
  });
  assert.deepEqual(payload, { amount: 1650, currency: "INR", receipt: id });
  assert.equal(result.orderId, "order_123");
  assert.equal(result.amountPaise, 1650);
  assert.ok(pool.calls.some(c => c.sql?.includes("COMMIT")));
});

test("reuses an existing order and does not call gateway twice", async () => {
  const pool = fakePool({ id, status: "awaiting_payment", amount_paise: 1000, currency: "INR", provider_order_id: "order_existing" });
  let calls = 0;
  const result = await createPaymentOrder(pool, id, { createOrder: async () => { calls++; } });
  assert.equal(result.reused, true);
  assert.equal(calls, 0);
});

test("rejects unpaid/ineligible jobs and rolls back", async () => {
  const pool = fakePool({ id, status: "uploaded", amount_paise: 1000, currency: "INR", provider_order_id: null });
  await assert.rejects(createPaymentOrder(pool, id, { createOrder: async () => { throw new Error("must not call"); } }), /not eligible/);
  assert.ok(pool.calls.some(c => c.sql?.includes("ROLLBACK")));
});

test("rejects invalid gateway order response", async () => {
  const pool = fakePool({ id, status: "awaiting_payment", amount_paise: 1000, currency: "INR", provider_order_id: null });
  await assert.rejects(createPaymentOrder(pool, id, { createOrder: async () => ({ id: "order_bad", amount: 500, currency: "INR" }) }), /invalid order/);
  assert.ok(pool.calls.some(c => c.sql?.includes("ROLLBACK")));
});
