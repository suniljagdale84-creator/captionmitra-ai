import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitAudioIntoChunks, probeMedia, extractAudio } from "../src/media-tools.mjs";

test("probeMedia rejects unsupported durations", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-media-"));
  const source = join(root, "source.mp4");
  await writeFile(source, "video");
  try {
    await assert.rejects(() => probeMedia(source, async () => ({
      stdout: JSON.stringify({ format: { duration: "20000", format_name: "mp4" } })
    })), /duration is unsupported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("splitAudioIntoChunks validates safe output directory and chunk sizes", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-media-"));
  const audio = join(root, "audio.mp3");
  const chunksDir = join(root, "chunks");
  await writeFile(audio, "audio");
  await mkdir(chunksDir);
  try {
    const chunks = await splitAudioIntoChunks(audio, chunksDir, {
      tempDir: root,
      runCommand: async (binary, args) => {
        assert.equal(binary, "ffmpeg");
        assert.ok(args.includes("-segment_time"));
        await writeFile(join(chunksDir, "chunk-000.mp3"), "part-one");
        await writeFile(join(chunksDir, "chunk-001.mp3"), "part-two");
        return { stdout: "", stderr: "" };
      }
    });
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].index, 0);
    assert.ok(chunks.every((chunk) => chunk.sizeBytes > 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("splitAudioIntoChunks rejects a directory outside worker temp", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-media-"));
  const audio = join(root, "audio.mp3");
  await writeFile(audio, "audio");
  try {
    await assert.rejects(() => splitAudioIntoChunks(audio, join(tmpdir(), "outside-chunks"), {
      tempDir: root,
      runCommand: async () => ({ stdout: "", stderr: "" })
    }), /inside the worker temp directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extractAudio uses mono 16kHz low bitrate output", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-media-"));
  const source = join(root, "source.mp4");
  const output = join(root, "audio.mp3");
  await writeFile(source, "video");
  try {
    await extractAudio(source, output, async (binary, args) => {
      assert.equal(binary, "ffmpeg");
      assert.ok(args.includes("16000"));
      assert.ok(args.includes("64k"));
      await writeFile(output, "audio");
      return { stdout: "", stderr: "" };
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
