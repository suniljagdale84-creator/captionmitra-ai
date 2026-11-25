import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadPrivateBlob } from "../src/blob-storage.mjs";

test("downloads private blob stream to a private local file", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-test-"));
  try {
    const result = await downloadPrivateBlob({
      pathname: "uploads/customer/video.mp4",
      token: "test-token",
      destination: join(root, "job", "source.mp4"),
      tempDir: root,
      getBlob: async (path, options) => {
        assert.equal(path, "uploads/customer/video.mp4");
        assert.equal(options.access, "private");
        assert.equal(options.token, "test-token");
        return {
          statusCode: 200,
          stream: new Blob([Buffer.from("fake-video")]).stream(),
          blob: { size: 10, contentType: "video/mp4", pathname: path }
        };
      }
    });
    assert.equal(result.sizeBytes, 10);
    assert.equal(await readFile(result.path, "utf8"), "fake-video");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects URLs and traversal in Blob pathname", async () => {
  await assert.rejects(() => downloadPrivateBlob({
    pathname: "https://attacker.example/file",
    token: "test-token",
    destination: "/tmp/captionmitra/file",
    tempDir: "/tmp/captionmitra",
    getBlob: async () => { throw new Error("must not call SDK"); }
  }), /Unsafe Blob pathname/);
});

test("rejects oversized Blob before writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-test-"));
  try {
    await assert.rejects(() => downloadPrivateBlob({
      pathname: "uploads/video.mp4",
      token: "test-token",
      destination: join(root, "video.mp4"),
      tempDir: root,
      maxBytes: 5,
      getBlob: async () => ({
        statusCode: 200,
        stream: new Blob(["123456"]).stream(),
        blob: { size: 6, contentType: "video/mp4" }
      })
    }), /exceeds the configured size limit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces the byte limit while streaming when metadata size is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-test-"));
  try {
    await assert.rejects(() => downloadPrivateBlob({
      pathname: "uploads/video.mp4",
      token: "test-token",
      destination: join(root, "video.mp4"),
      tempDir: root,
      maxBytes: 5,
      getBlob: async () => ({
        statusCode: 200,
        stream: new Blob(["123456"]).stream(),
        blob: { size: null, contentType: "video/mp4" }
      })
    }), /exceeds the configured size limit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
