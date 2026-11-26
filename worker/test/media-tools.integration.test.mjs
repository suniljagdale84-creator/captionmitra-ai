import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runMediaCommand,
  probeMedia,
  extractAudio,
  splitAudioIntoChunks
} from "../src/media-tools.mjs";

test("real FFmpeg/FFprobe pipeline probes video, extracts audio and creates bounded chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-ffmpeg-integration-"));
  const source = join(root, "fixture.mp4");
  const audio = join(root, "audio.mp3");
  const chunksDir = join(root, "chunks");

  try {
    // A deterministic 65-second synthetic MP4 fixture; no external media or network.
    await runMediaCommand("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=160x120:r=10:d=65",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=65",
      "-shortest", "-c:v", "mpeg4", "-q:v", "12",
      "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart",
      source
    ], { timeoutMs: 120_000 });

    const metadata = await probeMedia(source);
    assert.ok(metadata.durationSeconds >= 64 && metadata.durationSeconds <= 66);
    assert.match(metadata.formatName, /mp4/);

    const extracted = await extractAudio(source, audio);
    assert.ok(extracted.size > 0);

    const chunks = await splitAudioIntoChunks(audio, chunksDir, {
      tempDir: root,
      chunkSeconds: 60,
      maxChunkBytes: 20 * 1024 * 1024
    });
    assert.equal(chunks.length, 2);
    assert.ok(chunks.every((chunk) => chunk.sizeBytes > 0 && chunk.sizeBytes <= 20 * 1024 * 1024));

    const chunkDurations = await Promise.all(chunks.map(async (chunk) => {
      const info = await probeMedia(chunk.path);
      return info.durationSeconds;
    }));
    assert.ok(chunkDurations[0] >= 59 && chunkDurations[0] <= 61);
    assert.ok(chunkDurations[1] >= 3 && chunkDurations[1] <= 7);
    assert.ok(Math.abs(chunkDurations.reduce((sum, duration) => sum + duration, 0) - metadata.durationSeconds) <= 1.5);
    assert.equal((await readdir(chunksDir)).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
