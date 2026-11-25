import test from "node:test";
import assert from "node:assert/strict";
import { claimNextJob, markJobRetryableFailure, completeJob } from "../src/queue.mjs";

function fakePool({ rows = [], failAt = null } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (failAt && sql === failAt) throw new Error("db failure");
      if (sql.includes("RETURNING job.id")) return { rows };
      if (sql.includes("RETURNING id")) return { rows };
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

test("completeJob rejects invalid result path", async () => {
  await assert.rejects(() => completeJob(fakePool(), "job-1", ""), /Invalid result storage path/);
});

test("retryable failure rejects unsafe error code", async () => {
  await assert.rejects(() => markJobRetryableFailure(fakePool(), "job-1", "bad code"), /Invalid error code/);
});
