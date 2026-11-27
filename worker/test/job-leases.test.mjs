import test from "node:test";
import assert from "node:assert/strict";
import { heartbeatJob, reclaimStaleJobs } from "../src/job-leases.mjs";

function poolWith(rows = []) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("RETURNING id") || sql.includes("SELECT id, status FROM changed")) return { rows };
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE" }); }
  };
  return { calls, async connect() { return client; }, async query(sql, values) {
    calls.push({ sql, values }); return { rows };
  }};
}

test("heartbeat refreshes lease only for its current owner", async () => {
  const pool = poolWith([{ id: "job-1" }]);
  assert.equal(await heartbeatJob(pool, "job-1", "worker-a"), true);
  const call = pool.calls.find(x => x.sql.includes("SET locked_at"));
  assert.deepEqual(call.values, ["job-1", "worker-a"]);
  assert.match(call.sql, /locked_by = \$2/);
});

test("heartbeat returns false when ownership is gone", async () => {
  assert.equal(await heartbeatJob(poolWith([]), "job-1", "worker-a"), false);
});

test("stale lease recovery locks rows and resets ownership", async () => {
  const pool = poolWith([{ id: "job-1", status: "queued" }]);
  const result = await reclaimStaleJobs(pool, 120);
  assert.deepEqual(result, { recovered: 1 });
  const sql = pool.calls.find(x => x.sql.includes("WITH stale")).sql;
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /locked_by = NULL/);
  assert.ok(pool.calls.some(x => x.sql === "COMMIT"));
});

test("stale lease timeout is bounded", async () => {
  await assert.rejects(reclaimStaleJobs(poolWith(), 5), /between 30 and 3600/);
});
