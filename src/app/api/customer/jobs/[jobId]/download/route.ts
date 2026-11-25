import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { jobId: string } };

export async function GET(request: Request, { params }: Context) {
  const base = process.env.WORKER_API_URL;
  const token = request.headers.get("x-customer-access-token") || "";
  const format = new URL(request.url).searchParams.get("format");
  if (!base) return NextResponse.json({ error: "Downloads are temporarily unavailable." }, { status: 503 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.jobId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) || !["srt","txt"].includes(format || "")) {
    return NextResponse.json({ error: "Invalid download request." }, { status: 400 });
  }
  try {
    const upstream = await fetch(`${base.replace(/\/$/, "")}/api/customer/jobs/${params.jobId}/download?format=${format}`, {
      headers: { "x-customer-access-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(30000)
    });
    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({}));
      return NextResponse.json(body, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": upstream.headers.get("content-disposition") || `attachment; filename="captions.${format}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Download service is temporarily unavailable." }, { status: 503 });
  }
}
