/**
 * Runs durable Blob cleanup on a fixed schedule.
 * The cleanup function is injected so scheduling can be tested without
 * connecting to Vercel Blob or PostgreSQL.
 */
export function startCleanupScheduler({
  cleanup,
  intervalMs = 15 * 60 * 1000,
  runImmediately = true,
  onResult = () => {}
}) {
  if (typeof cleanup !== "function") throw new Error("Cleanup callback is required");
  if (!Number.isInteger(intervalMs) || intervalMs < 60_000 || intervalMs > 60 * 60 * 1000) {
    throw new Error("Cleanup interval must be between 1 and 60 minutes");
  }

  let stopped = false;
  let inFlight = false;

  const run = async () => {
    if (stopped || inFlight) return { skipped: true };
    inFlight = true;
    try {
      const result = await cleanup();
      onResult({ ok: true, result });
      return { ok: true, result };
    } catch {
      // Do not expose blob paths, customer data, or credentials in scheduler output.
      onResult({ ok: false, errorCode: "cleanup_run_failed" });
      return { ok: false, errorCode: "cleanup_run_failed" };
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => { void run(); }, intervalMs);
  timer.unref?.();
  if (runImmediately) void run();

  return {
    run,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    get running() {
      return inFlight;
    }
  };
}

/** Aggregate operational counters; never returns customer paths or content. */
export async function getCleanupStats(pool) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE locked_at IS NULL AND available_at <= NOW())::int AS ready_tasks,
       COUNT(*) FILTER (WHERE locked_at IS NOT NULL)::int AS locked_tasks,
       COUNT(*) FILTER (WHERE available_at > NOW())::int AS delayed_tasks,
       COALESCE(SUM(attempt_count), 0)::bigint AS total_attempts,
       MIN(created_at) AS oldest_task_at
     FROM caption_blob_cleanup_tasks`
  );
  return result.rows[0];
}
