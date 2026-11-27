import test from "node:test";
import assert from "node:assert/strict";
import { cleanupExpiredJobs } from "../src/retention.mjs";

function mockPool(rows) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("SELECT id, source_blob_path, result_blob_path")) return { rows };
      if (String(sql).includes("UPDATE caption_jobs SET status = 'expired'")) return { rows: [{ id: params[0] }] };
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE" }); }
  };
  return { calls, async connect() { return client; } };
}

const token = "private-test-token";

test("deletes private source and result blobs before expiring an eligible job", async () => {
  const pool = mockPool([{ id: "job-1", source_blob_path: "uploads/source.mp4", result_blob_path: "results/job.json" }]);
  const deleted = [];
  const result = await cleanupExpiredJobs({
    pool, blobToken: token,
    deleteBlob: async (path, options) => { deleted.push({ path, options }); }
  });
  assert.deepEqual(deleted.map(item => item.path), ["uploads/source.mp4", "results/job.json"]);
  assert.ok(deleted.every(item => item.options.access === "private" && item.options.token === token));
  assert.deepEqual(result, { examined: 1, expiredJobs: 1, deletionFailures: 0 });
  assert.ok(pool.calls.some(call => call.sql.includes("SET status = 'expired'")));
  assert.ok(pool.calls.some(call => call.sql === "COMMIT"));
});

test("does not expire a job or clear its paths if any Blob deletion fails", async () => {
  const pool = mockPool([{ id: "job-2", source_blob_path: "uploads/source.mp4", result_blob_path: "results/job.json" }]);
  const result = await cleanupExpiredJobs({
    pool, blobToken: token,
    deleteBlob: async path => { if (path.startsWith("results/")) throw new Error("provider unavailable"); }
  });
  assert.deepEqual(result, { examined: 1, expiredJobs: 0, deletionFailures: 1 });
  assert.equal(pool.calls.some(call => call.sql.includes("SET status = 'expired'")), false);
  assert.ok(pool.calls.some(call => call.sql === "COMMIT"));
});

test("requires database and private Blob credentials", async () => {
  await assert.rejects(() => cleanupExpiredJobs({}), /PostgreSQL pool/);
  await assert.rejects(() => cleanupExpiredJobs({ pool: { connect() {} } }), /Blob read\/write token/);
});

test("validates bounded cleanup batch size", async () => {
  await assert.rejects(() => cleanupExpiredJobs({ pool: { connect() {} }, blobToken: token, batchSize: 0 }), /batch size/);
  await assert.rejects(() => cleanupExpiredJobs({ pool: { connect() {} }, blobToken: token, batchSize: 101 }), /batch size/);
});
