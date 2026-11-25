import test from "node:test";
import assert from "node:assert/strict";
import { getPublicProgress, updateJobProgress } from "../src/job-progress.mjs";

test("progress update is conditional on active worker ownership", async () => {
  let call;
  const pool = { async query(sql, values) { call = { sql, values }; return { rows: [{ id: "job-1" }] }; } };
  assert.equal(await updateJobProgress(pool, "job-1", "worker-1", "transcribing"), true);
  assert.deepEqual(call.values, ["job-1", "worker-1", "transcribing", 45]);
  assert.match(call.sql, /locked_by = \$2/);
});

test("progress rejects invalid stages", async () => {
  await assert.rejects(updateJobProgress({ query: async () => ({ rows: [] }) }, "job", "worker", "unknown"), /Invalid worker progress stage/);
});

test("public progress contains only safe status fields", () => {
  assert.deepEqual(getPublicProgress("processing", "translating", 75), {
    status: "processing", stage: "translating", percent: 75
  });
  assert.equal(getPublicProgress("not-a-status", "private-path", 500).status, "unknown");
  assert.equal(getPublicProgress("processing", "private-path", 500).percent, 0);
});
