import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { loadWorkerConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";
import { downloadCustomerResult } from "./customer-download.mjs";

const config = loadWorkerConfig();
const pool = createDatabase(config.databaseUrl);

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

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    try {
      await pool.query("SELECT 1");
      send(response, 200, { ok: true, service: "captionmitra-worker", database: "connected", processingEnabled: false });
    } catch {
      send(response, 503, { ok: false, service: "captionmitra-worker", database: "unavailable" });
    }
    return;
  }

  if (!isAuthorized(request)) {
    send(response, 401, { error: "unauthorized" });
    return;
  }

  if (request.method === "GET" && request.url === "/internal/worker/status") {
    try {
      const result = await pool.query("SELECT COUNT(*)::int AS queued_jobs FROM caption_jobs WHERE status = 'queued'");
      send(response, 200, { ok: true, service: "captionmitra-worker", queuedJobs: result.rows[0].queued_jobs, processingEnabled: false });
    } catch {
      send(response, 503, { error: "database_unavailable" });
    }
    return;
  }

  const url = new URL(request.url || "/", "http://127.0.0.1");
  const downloadMatch = url.pathname.match(/^\/internal\/customer\/jobs\/([0-9a-f-]{36})\/download$/i);
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

async function shutdown() {
  server.close();
  await pool.end();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
