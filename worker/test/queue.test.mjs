import test from "node:test";
import assert from "node:assert/strict";
import { claimNextJob, markJobRetryableFailure, completeJob } from "../src/queue.mjs";

function fakePool({ rows = [] } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("RETURNING job.id") || sql.includes("RETURNING id")) return { rows };
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE" }); }
  };
  return {
    calls,
    async connect() { return client; },
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows };
    }
  };
}

test("claimNextJob locks one queued job and records the claim", async () => {
  const job = { id: "job-1", source_blob_path: "private/file.mp4" };
  const pool = fakePool({ rows: [job] });
  const result = await claimNextJob(pool, "worker-a");
  assert.equal(result.id, "job-1");
  assert.ok(pool.calls.some((call) => call.sql.includes("FOR UPDATE SKIP LOCKED")));
  assert.ok(pool.calls.some((call) => call.sql === "COMMIT"));
  assert.ok(pool.calls.some((call) => call.sql.includes("worker_claimed")));
});

test("claimNextJob rejects invalid worker id", async () => {
  await assert.rejects(() => claimNextJob(fakePool(), ""), /Invalid worker identifier/);
});

test("completion requires a valid worker id and result path", async () => {
  await assert.rejects(() => completeJob(fakePool(), "job-1", "", "result.srt"), /Invalid worker identifier/);
  await assert.rejects(() => completeJob(fakePool(), "job-1", "worker-a", ""), /Invalid result storage path/);
});

test("completion is scoped to the worker holding the job lease", async () => {
  const pool = fakePool({ rows: [{ id: "job-1" }] });
  assert.equal(await completeJob(pool, "job-1", "worker-a", "private/result.srt"), true);
  const update = pool.calls.find((call) => call.sql.includes("SET status = 'completed'"));
  assert.deepEqual(update.values, ["job-1", "private/result.srt", "worker-a"]);
  assert.ok(update.sql.includes("locked_by = $3"));
});

test("retryable failure rejects unsafe error code and invalid worker", async () => {
  await assert.rejects(() => markJobRetryableFailure(fakePool(), "job-1", "worker-a", "bad code"), /Invalid error code/);
  await assert.rejects(() => markJobRetryableFailure(fakePool(), "job-1", "", "processing_error"), /Invalid worker identifier/);
});

test("retry update is scoped to the worker holding the job lease", async () => {
  const pool = fakePool({ rows: [{ id: "job-1", status: "queued", retry_count: 1 }] });
  await markJobRetryableFailure(pool, "job-1", "worker-a", "processing_error");
  const update = pool.calls.find((call) => call.sql.includes("UPDATE caption_jobs"));
  assert.deepEqual(update.values, ["job-1", "processing_error", "worker-a"]);
  assert.ok(update.sql.includes("locked_by = $3"));
});
