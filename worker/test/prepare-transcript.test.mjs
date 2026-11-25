import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTranscriptFiles } from "../src/prepare-transcript.mjs";

test("creates timestamped SRT and plain text transcript", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-output-"));
  try {
    const result = await prepareTranscriptFiles({
      id: "job-123",
      source_blob_path: "uploads/test.mp4",
      source_content_type: "video/mp4",
      source_size_bytes: "100"
    }, {
      tempDir: root,
      maxInputBytes: 200 * 1024 * 1024,
      maxJobDurationSeconds: 10800,
      blobReadWriteToken: "test",
      openAiApiKey: "test",
      transcriptionModel: "whisper-1"
    }, {
      mediaDependencies: {
        downloadPrivateBlob: async ({ destination }) => {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(destination, "video");
          return { sizeBytes: 100, contentType: "video/mp4" };
        },
        probeMedia: async () => ({ durationSeconds: 60, formatName: "mp4" }),
        extractAudio: async (_source, output) => {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(output, "audio");
        },
        splitAudioIntoChunks: async (_audio, dir) => {
          const { mkdir, writeFile } = await import("node:fs/promises");
          await mkdir(dir, { recursive: true });
          const path = join(dir, "chunk-000.mp3");
          await writeFile(path, "chunk");
          return [{ path, sizeBytes: 5, index: 0 }];
        }
      },
      transcribeChunks: async (_chunks, options) => {
        assert.equal(options.model, "whisper-1");
        return {
          text: "Hello CaptionMitra",
          segments: [{ start: 0, end: 2.5, text: "Hello CaptionMitra" }]
        };
      }
    });
    assert.equal(result.segmentCount, 1);
    assert.match(await readFile(result.srtPath, "utf8"), /00:00:00,000 --> 00:00:02,500/);
    assert.equal(await readFile(result.txtPath, "utf8"), "Hello CaptionMitra\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
