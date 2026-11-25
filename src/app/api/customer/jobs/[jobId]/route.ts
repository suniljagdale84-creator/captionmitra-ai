import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { jobId: string } };

export async function GET(request: Request, { params }: Context) {
  const base = process.env.WORKER_API_URL;
  const token = request.headers.get("x-customer-access-token") || "";
  if (!base) return NextResponse.json({ error: "Customer status is temporarily unavailable." }, { status: 503 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.jobId)) {
    return NextResponse.json({ error: "Invalid job identifier." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ error: "Access key is required." }, { status: 401 });
  try {
    const upstream = await fetch(`${base.replace(/\/$/, "")}/api/customer/jobs/${params.jobId}`, {
      headers: { "x-customer-access-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    const body = await upstream.json();
    return NextResponse.json(body, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Customer status is temporarily unavailable." }, { status: 503 });
  }
}
