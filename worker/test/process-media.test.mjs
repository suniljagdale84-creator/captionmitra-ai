import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withPreparedMedia } from "../src/process-media.mjs";

const configFor = (tempDir) => ({
  tempDir,
  maxInputBytes: 200 * 1024 * 1024,
  maxJobDurationSeconds: 3 * 60 * 60,
  blobReadWriteToken: "test-only-token"
});
const job = {
  id: "job-1",
  source_blob_path: "uploads/user/video.mp4",
  source_content_type: "video/mp4",
  source_size_bytes: "100",
  media_duration_seconds: "60"
};

test("prepares media chunks and removes all temporary files afterward", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-pipeline-"));
  try {
    const result = await withPreparedMedia(job, configFor(root), async ({ chunks, metadata }) => {
      assert.equal(chunks.length, 1);
      assert.equal(metadata.durationSeconds, 60);
      return "prepared";
    }, {
      downloadPrivateBlob: async ({ destination }) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(destination, "source");
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
    });
    assert.equal(result, "prepared");
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsupported content type before downloading", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-pipeline-"));
  try {
    await assert.rejects(() => withPreparedMedia(
      { ...job, source_content_type: "application/octet-stream" },
      configFor(root),
      async () => {},
      { downloadPrivateBlob: async () => { throw new Error("must not download"); } }
    ), /Unsupported job media metadata/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes temporary directory when a processing stage fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-pipeline-"));
  try {
    await assert.rejects(() => withPreparedMedia(job, configFor(root), async () => {}, {
      downloadPrivateBlob: async ({ destination }) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(destination, "source");
        return { sizeBytes: 100, contentType: "video/mp4" };
      },
      probeMedia: async () => { throw new Error("probe failed"); }
    }), /probe failed/);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
