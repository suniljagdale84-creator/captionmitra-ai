import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribeAudioChunk, transcribeChunks } from "../src/transcription.mjs";
import { segmentsToSrt } from "../src/subtitles.mjs";

test("transcribes one chunk and requests timestamped verbose JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-stt-"));
  const path = join(root, "chunk.mp3");
  await writeFile(path, "audio-bytes");
  try {
    const result = await transcribeAudioChunk({ path, sizeBytes: 11, index: 0 }, {
      apiKey: "test-key",
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
        assert.equal(options.headers.Authorization, "Bearer test-key");
        assert.equal(options.body.get("model"), "whisper-1");
        assert.equal(options.body.get("response_format"), "verbose_json");
        assert.equal(options.body.get("timestamp_granularities[]"), "segment");
        return new Response(JSON.stringify({
          text: "Hello world",
          segments: [{ start: 0, end: 2, text: "Hello world" }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    });
    assert.equal(result.text, "Hello world");
    assert.equal(result.segments[0].end, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retries a temporary 429 response then succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-stt-"));
  const path = join(root, "chunk.mp3");
  await writeFile(path, "audio");
  let calls = 0;
  try {
    const result = await transcribeAudioChunk({ path, sizeBytes: 5, index: 0 }, {
      apiKey: "test-key",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("busy", { status: 429 });
        return new Response(JSON.stringify({ text: "Hi", segments: [{ start: 0, end: 1, text: "Hi" }] }), { status: 200 });
      }
    });
    assert.equal(calls, 2);
    assert.equal(result.text, "Hi");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("combines chunk timestamps using the eight-minute offset", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-stt-"));
  const p0 = join(root, "a.mp3"), p1 = join(root, "b.mp3");
  await writeFile(p0, "a"); await writeFile(p1, "b");
  try {
    const result = await transcribeChunks([
      { path: p0, sizeBytes: 1, index: 0 },
      { path: p1, sizeBytes: 1, index: 1 }
    ], {
      apiKey: "test-key",
      fetchImpl: async () => new Response(JSON.stringify({
        text: "line",
        segments: [{ start: 1, end: 2, text: "line" }]
      }), { status: 200 }),
      chunkSeconds: 480
    });
    assert.equal(result.segments[1].start, 481);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("formats ordered SRT subtitles with millisecond timestamps", () => {
  const srt = segmentsToSrt([
    { start: 0, end: 1.25, text: "Hello" },
    { start: 1.25, end: 3, text: "World" }
  ]);
  assert.match(srt, /00:00:00,000 --> 00:00:01,250/);
  assert.match(srt, /2\n00:00:01,250 --> 00:00:03,000/);
});
