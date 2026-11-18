import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI API key is not configured. Add OPENAI_API_KEY in Vercel Environment Variables." }, { status: 500 });
    }
    const form = await request.formData();
    const file = form.get("file");
    const language = String(form.get("language") || "Hindi");
    if (!(file instanceof File)) return NextResponse.json({ error: "Please upload a video or audio file." }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "File is larger than 25 MB. Please upload a smaller file." }, { status: 413 });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcription = await client.audio.transcriptions.create({
      file: new File([await file.arrayBuffer()], file.name, { type: file.type || "application/octet-stream" }),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
    const raw = (transcription as unknown as { segments?: { start: number; end: number; text: string }[] }).segments || [];
    if (!raw.length) return NextResponse.json({ error: "No speech segments were detected in this file." }, { status: 422 });

    const translated = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Translate each subtitle segment into ${language}. Keep the meaning natural and concise. Return only JSON: {"segments":[{"text":"..."}]}. Preserve one output item per input item and do not merge segments.` },
        { role: "user", content: JSON.stringify(raw.map(s => ({ text: s.text }))) },
      ],
    });
    const parsed = JSON.parse(translated.choices[0]?.message?.content || "{}") as { segments?: { text: string }[] };
    const output = raw.map((s, i) => ({ start: s.start, end: s.end, text: parsed.segments?.[i]?.text || s.text }));
    return NextResponse.json({ segments: output });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Caption generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
