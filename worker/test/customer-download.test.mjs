import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerAccessToken } from "../src/customer-access-token.mjs";
import { downloadCustomerResult } from "../src/customer-download.mjs";

const jobId = "123e4567-e89b-42d3-a456-426614174000";
const payload = { version: 1, jobId, files: { srt: { content: "1\\nsubtitle\\n" }, txt: { content: "subtitle\\n" } } };

test("returns only the requested file after token, job and expiry checks", async () => {
  const access = createCustomerAccessToken();
  let queryCount = 0;
  const pool = { query: async (sql) => {
    queryCount++;
    if (sql.startsWith("SELECT")) return { rows: [{ status: "completed", result_blob_path: "results/job/result.json", customer_access_token_hash: access.tokenHash, expires_at: new Date(Date.now() + 60000) }] };
    return { rows: [] };
  } };
  const result = await downloadCustomerResult({
    pool, blobToken: "private-token", jobId, accessToken: access.token, format: "srt",
    getBlob: async (path, options) => {
      assert.equal(path, "results/job/result.json");
      assert.equal(options.access, "private");
      const json = JSON.stringify(payload);
      return { statusCode: 200, stream: new Response(json).body, blob: { size: Buffer.byteLength(json) } };
    }
  });
  assert.equal(result.filename, "captions.srt");
  assert.equal(result.content, "1\\nsubtitle\\n");
  assert.equal(queryCount, 2);
});

test("rejects wrong access token without reading private Blob", async () => {
  const access = createCustomerAccessToken();
  const pool = { query: async () => ({ rows: [{ status: "completed", result_blob_path: "results/job/result.json", customer_access_token_hash: access.tokenHash, expires_at: new Date(Date.now() + 60000) }] }) };
  await assert.rejects(() => downloadCustomerResult({
    pool, blobToken: "private-token", jobId, accessToken: createCustomerAccessToken().token, format: "txt",
    getBlob: async () => { throw new Error("must not read"); }
  }), /invalid/);
});

test("rejects expired or incomplete jobs and unsupported formats", async () => {
  const access = createCustomerAccessToken();
  const pool = { query: async () => ({ rows: [{ status: "processing", result_blob_path: null, customer_access_token_hash: access.tokenHash, expires_at: new Date(Date.now() + 60000) }] }) };
  await assert.rejects(() => downloadCustomerResult({ pool, blobToken: "private-token", jobId, accessToken: access.token, format: "srt" }), /unavailable/);
  await assert.rejects(() => downloadCustomerResult({ pool, blobToken: "private-token", jobId, accessToken: access.token, format: "pdf" }), /Unsupported/);
});
