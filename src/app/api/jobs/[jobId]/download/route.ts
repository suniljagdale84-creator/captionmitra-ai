import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { getCustomerDownload } from "@/lib/customer-download.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
declare global { var captionMitraDownloadPool: Pool | undefined; }

function pool() {
  if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
  if (!globalThis.captionMitraDownloadPool) globalThis.captionMitraDownloadPool = new Pool({
    connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: "captionmitra-download"
  });
  return globalThis.captionMitraDownloadPool;
}

export async function POST(request: Request, context: { params: { jobId: string } }) {
  try {
    const body = await request.json() as { customerAccessToken?: unknown };
    const result = await getCustomerDownload(pool(), get, {
      jobId: context.params.jobId,
      accessToken: body.customerAccessToken as string
    });
    const headers = new Headers({
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    if (typeof result.size === "number") headers.set("Content-Length", String(result.size));
    headers.set("X-Download-Count", String(result.downloadCount));
    return new Response(result.stream, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download unavailable";
    const status = /Invalid access key/.test(message) ? 401 : /not found|expired|unavailable|revoked/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: status === 500 ? "Secure download is temporarily unavailable." : message }, {
      status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" }
    });
  }
}
