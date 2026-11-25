import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerAccessToken } from "../src/customer-access-token.mjs";
import { getCustomerJobStatus } from "../src/customer-status.mjs";

const jobId = "f9c2c41e-8d9e-4d4b-9b2c-8aab6e9f1a11";

test("returns only safe progress and payment metadata for valid token", async () => {
  const credential = createCustomerAccessToken();
  let sql;
  const pool = { async query(statement, values) {
    sql = statement;
    assert.deepEqual(values, [jobId]);
    return { rows: [{
      status: "processing", amount_paise: 1200, currency: "INR",
      output_language: "Marathi", progress_stage: "transcribing",
      progress_percent: 45, progress_updated_at: new Date("2026-01-01T00:00:00Z"),
      payment_verified_at: new Date("2026-01-01T00:00:00Z"),
      result_blob_path: null, expires_at: new Date("2027-01-01T00:00:00Z"),
      customer_access_token_hash: credential.tokenHash
    }] };
  }};
  const status = await getCustomerJobStatus({ pool, jobId, accessToken: credential.token, now: Date.parse("2026-06-01") });
  assert.equal(status.status, "processing");
  assert.equal(status.progressPercent, 45);
  assert.equal(status.payment.status, "verified");
  assert.deepEqual(status.downloads, { available: false, formats: [] });
  assert.doesNotMatch(JSON.stringify(status), /blob_path|token_hash|transcript/i);
  assert.match(sql, /customer_access_token_hash/);
});

test("does not reveal whether job exists for invalid token", async () => {
  const credential = createCustomerAccessToken();
  const pool = { async query() { return { rows: [{
    status: "completed", amount_paise: 1000, currency: "INR",
    output_language: "Hindi", progress_stage: "completed", progress_percent: 100,
    result_blob_path: "private/path", expires_at: new Date("2027-01-01"),
    customer_access_token_hash: credential.tokenHash
  }] }; }};
  await assert.rejects(
    getCustomerJobStatus({ pool, jobId, accessToken: createCustomerAccessToken().token }),
    /unavailable/
  );
});

test("reports completed job expired and hides downloads", async () => {
  const credential = createCustomerAccessToken();
  const pool = { async query() { return { rows: [{
    status: "completed", amount_paise: 1000, currency: "INR",
    output_language: "English", progress_stage: "completed", progress_percent: 100,
    result_blob_path: "private/path", expires_at: new Date("2026-01-01"),
    customer_access_token_hash: credential.tokenHash
  }] }; }};
  const status = await getCustomerJobStatus({ pool, jobId, accessToken: credential.token, now: Date.parse("2026-02-01") });
  assert.equal(status.status, "expired");
  assert.equal(status.downloads.available, false);
});

test("rejects invalid job identifiers", async () => {
  await assert.rejects(getCustomerJobStatus({ pool: { query: async () => ({ rows: [] }) }, jobId: "bad", accessToken: "bad" }), /Invalid job identifier/);
});


test("reports failed payment attempt without changing the job's payable lifecycle", async () => {
  const credential = createCustomerAccessToken();
  const pool = { async query(statement, values) {
    assert.match(statement, /payment_attempt_status/);
    assert.match(statement, /caption_media_inspections/);
    assert.deepEqual(values, [jobId]);
    return { rows: [{
      status: "awaiting_payment", amount_paise: 1205, currency: "INR",
      output_language: "Hindi", progress_stage: "awaiting_payment",
      progress_percent: 0, progress_updated_at: null,
      payment_verified_at: null, payment_attempt_status: "failed",
      inspection_status: "completed", inspection_error_code: null,
      result_blob_path: null, expires_at: new Date("2027-01-01T00:00:00Z"),
      customer_access_token_hash: credential.tokenHash
    }] };
  }};
  const status = await getCustomerJobStatus({
    pool, jobId, accessToken: credential.token, now: Date.parse("2026-06-01")
  });
  assert.equal(status.status, "awaiting_payment");
  assert.equal(status.payment.status, "failed");
  assert.equal(status.payment.amountPaise, 1205);
  assert.equal(status.inspection.status, "completed");
  assert.equal(status.downloads.available, false);
});
