import test from "node:test";
import assert from "node:assert/strict";
import { startCleanupScheduler, getCleanupStats } from "../src/cleanup-scheduler.mjs";

test("scheduler runs immediately and can be stopped", async () => {
  let calls = 0;
  const scheduler = startCleanupScheduler({
    cleanup: async () => ({ deleted: ++calls }),
    intervalMs: 60_000
  });
  await new Promise(resolve => setImmediate(resolve));
  scheduler.stop();
  assert.equal(calls, 1);
  assert.equal(scheduler.running, false);
});

test("scheduler prevents overlapping cleanup runs", async () => {
  let release;
  let calls = 0;
  const scheduler = startCleanupScheduler({
    cleanup: () => {
      calls++;
      return new Promise(resolve => { release = resolve; });
    },
    intervalMs: 60_000,
    runImmediately: false
  });
  const first = scheduler.run();
  const second = await scheduler.run();
  assert.deepEqual(second, { skipped: true });
  release({ deleted: 0 });
  await first;
  scheduler.stop();
  assert.equal(calls, 1);
});

test("scheduler validates interval and callback", () => {
  assert.throws(() => startCleanupScheduler({ cleanup: null }), /callback/);
  assert.throws(() => startCleanupScheduler({ cleanup() {}, intervalMs: 1000 }), /interval/);
});

test("cleanup stats returns aggregate counters only", async () => {
  const pool = {
    async query(sql) {
      assert.match(sql, /caption_blob_cleanup_tasks/);
      return { rows: [{ ready_tasks: 2, locked_tasks: 1, delayed_tasks: 3, total_attempts: "7", oldest_task_at: null }] };
    }
  };
  const stats = await getCleanupStats(pool);
  assert.equal(stats.ready_tasks, 2);
  assert.equal(stats.locked_tasks, 1);
  assert.equal("blob_path" in stats, false);
});
