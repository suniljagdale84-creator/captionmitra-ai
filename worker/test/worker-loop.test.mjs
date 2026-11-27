import test from "node:test";
import assert from "node:assert/strict";
import { runWorkerLoop } from "../src/worker-loop.mjs";

function oneJobPool() {
  let claimed = false;
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes("RETURNING job.id")) {
        if (claimed) return { rows: [] };
        claimed = true;
        return { rows: [{ id: "job-1", source_blob_path: "uploads/test.mp4" }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  return {
    calls,
    async connect() { return client; }
  };
}

test("worker loop processes a claimed job and stops on abort", async () => {
  const pool = oneJobPool();
  const controller = new AbortController();
  let processed = 0;
  await runWorkerLoop({
    pool,
    concurrency: 1,
    workerId: "test-worker",
    pollIntervalMs: 1,
    signal: controller.signal,
    processJob: async (job, owner) => {
      assert.equal(job.id, "job-1");
      assert.equal(owner, "test-worker-1");
      processed += 1;
      controller.abort();
    }
  });
  assert.equal(processed, 1);
  assert.ok(pool.calls.some((sql) => sql === "COMMIT"));
});

test("worker loop rejects unsupported concurrency", async () => {
  await assert.rejects(() => runWorkerLoop({
    pool: oneJobPool(),
    concurrency: 3,
    processJob: async () => {}
  }), /between 1 and 2/);
});
