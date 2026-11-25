import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { del } from "@vercel/blob";
import { loadWorkerConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";
import { downloadCustomerResult } from "./customer-download.mjs";
import { runBlobCleanup } from "./cleanup.mjs";
import { startCleanupScheduler, getCleanupStats } from "./cleanup-scheduler.mjs";
import { runWorkerLoop } from "./worker-loop.mjs";
import { processCaptionJob } from "./process-caption-job.mjs";
import { getCustomerJobStatus } from "./customer-status.mjs";

const config = loadWorkerConfig();
const pool = createDatabase(config.databaseUrl);
const workerAbort = new AbortController();
const workerLoop = runWorkerLoop({
  pool,
  concurrency: config.concurrency,
  processJob: (job, workerId) => processCaptionJob(job, workerId, config, { pool }),
  signal: workerAbort.signal
}).catch(() => {
  process.stderr.write("CaptionMitra worker loop stopped unexpectedly.\\n");
});

function isAuthorized(request) {
  const value = request.headers.authorization || "";
  const expected = `Bearer ${config.sharedSecret}`;
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

const cleanupScheduler = startCleanupScheduler({
  intervalMs: 15 * 60 * 1000,
  cleanup: () => runBlobCleanup(pool, (pathname) =>
    del(pathname, { access: "private", token: config.blobReadWriteToken })
  ),
  onResult: (result) => {
    // Keep operational logs free of customer filenames, paths and credentials.
    process.stdout.write(JSON.stringify({
      event: "blob_cleanup",
      ok: result.ok,
      ...(result.ok ? result.result : { errorCode: result.errorCode })
    }) + "\\n");
  }
});

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    try {
      await pool.query("SELECT 1");
      send(response, 200, { ok: true, service: "captionmitra-worker", database: "connected", cleanupScheduler: "running", processingEnabled: true });
    } catch {
      send(response, 503, { ok: false, service: "captionmitra-worker", database: "unavailable", cleanupScheduler: "running" });
    }
    return;
  }

  if (!isAuthorized(request)) {
    send(response, 401, { error: "unauthorized" });
    return;
  }

  if (request.method === "GET" && request.url === "/internal/worker/status") {
    try {
      const [jobs, cleanup] = await Promise.all([
        pool.query("SELECT COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_jobs, COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_jobs FROM caption_jobs"),
        getCleanupStats(pool)
      ]);
      send(response, 200, {
        ok: true,
        service: "captionmitra-worker",
        queuedJobs: jobs.rows[0].queued_jobs,
        processingJobs: jobs.rows[0].processing_jobs,
        cleanupScheduler: "running",
        cleanup
      });
    } catch {
      send(response, 503, { error: "database_unavailable" });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/internal/worker/cleanup/run") {
    const result = await cleanupScheduler.run();
    send(response, 200, result);
    return;
  }

  const url = new URL(request.url || "/", "http://127.0.0.1");
  const statusMatch = url.pathname.match(/^\/api\/customer\/jobs\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && statusMatch) {
    const accessToken = request.headers["x-customer-access-token"];
    try {
      const status = await getCustomerJobStatus({
        pool,
        jobId: statusMatch[1],
        accessToken: Array.isArray(accessToken) ? "" : accessToken
      });
      send(response, 200, status);
    } catch {
      send(response, 404, { error: "job_status_unavailable" });
    }
    return;
  }

  const downloadMatch = url.pathname.match(/^\/api\/customer\/jobs\/([0-9a-f-]{36})\/download$/i);
  if (request.method === "GET" && downloadMatch) {
    const accessToken = request.headers["x-customer-access-token"];
    const format = url.searchParams.get("format");
    try {
      const file = await downloadCustomerResult({
        pool,
        blobToken: config.blobReadWriteToken,
        jobId: downloadMatch[1],
        accessToken: Array.isArray(accessToken) ? "" : accessToken,
        format
      });
      response.writeHead(200, {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": Buffer.byteLength(file.content, "utf8")
      });
      response.end(file.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const status = message.includes("Invalid") || message.includes("unavailable") ? 404 : 400;
      send(response, status, { error: status === 404 ? "download_unavailable" : "download_request_invalid" });
    }
    return;
  }

  send(response, 404, { error: "not_found" });
});

server.listen(config.port || 8080, "127.0.0.1", () => {
  process.stdout.write("CaptionMitra worker API started on loopback.\\n");
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  cleanupScheduler.stop();
  workerAbort.abort();
  await new Promise(resolve => server.close(resolve));
  await workerLoop;
  await pool.end();
}
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
