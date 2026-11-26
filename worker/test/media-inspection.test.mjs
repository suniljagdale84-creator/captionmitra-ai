import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOneUploadedMedia } from "../src/media-inspection.mjs";

function fakePool(job) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("RETURNING job.id")) return { rows: [{ ...job, attempt_count: 1 }] };
      if (sql.includes("RETURNING job_id")) return { rows: [{ job_id: job.id }] };
      if (sql.includes("RETURNING id")) return { rows: [{ id: job.id }] };
      return { rows: [] };
    },
    release() {}
  };
  return { calls, async connect() { return client; } };
}

test("pre-payment inspection measures duration and stores prorated price from server metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-inspection-"));
  const job = {
    id: "job-1",
    source_blob_path: "incoming/test-video.mp4",
    source_size_bytes: 120,
    source_content_type: "video/mp4",
    attempt_count: 1
  };
  const pool = fakePool(job);
  try {
    const result = await inspectOneUploadedMedia({
      pool,
      config: {
        tempDir: root,
        maxInputBytes: 200 * 1024 * 1024,
        maxJobDurationSeconds: 3 * 60 * 60,
        blobReadWriteToken: "test-token"
      },
      workerId: "inspector-test",
      dependencies: {
        downloadPrivateBlob: async ({ destination }) => {
          await writeFile(destination, "fake-media");
          return { sizeBytes: 120, contentType: "video/mp4" };
        },
        probeMedia: async () => ({ durationSeconds: 241, formatName: "mp4" })
      }
    });
    assert.deepEqual(result, { jobId: "job-1", durationSeconds: 241, amountPaise: 1205 });
    const recoveryIndex = pool.calls.findIndex(call =>
      call.sql.includes("locked_at < NOW() - INTERVAL '5 minutes'") &&
      call.sql.includes("inspection_lease_expired")
    );
    const claimIndex = pool.calls.findIndex(call => call.sql.includes("WITH candidate AS"));
    assert.ok(recoveryIndex >= 0, "stale inspection leases must be recovered");
    assert.ok(claimIndex > recoveryIndex, "lease recovery must run before claiming pending work");
    assert.ok(pool.calls.some(call => call.sql.includes("media_duration_seconds = $2") && call.values[1] === 241));
    assert.ok(pool.calls.some(call => call.sql.includes("amount_paise = $3") && call.values[2] === 1205));
    assert.ok(pool.calls.some(call => call.sql.includes("status = 'completed'")));
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspection rejects a mismatch between stored upload size and downloaded bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-inspection-"));
  const job = {
    id: "job-2",
    source_blob_path: "incoming/test-video.mp4",
    source_size_bytes: 120,
    source_content_type: "video/mp4",
    attempt_count: 1
  };
  const pool = fakePool(job);
  try {
    const result = await inspectOneUploadedMedia({
      pool,
      config: {
        tempDir: root,
        maxInputBytes: 200 * 1024 * 1024,
        maxJobDurationSeconds: 3 * 60 * 60,
        blobReadWriteToken: "test-token"
      },
      workerId: "inspector-test",
      dependencies: {
        downloadPrivateBlob: async ({ destination }) => {
          await writeFile(destination, "fake-media");
          return { sizeBytes: 99, contentType: "video/mp4" };
        },
        probeMedia: async () => { throw new Error("probe must not run"); }
      }
    });
    assert.equal(result.failed, false);
    assert.ok(pool.calls.some(call => call.sql.includes("last_error_code = $3")));
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("inspection failure retries safely and removes temporary media", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-inspection-"));
  const job = {
    id: "job-3",
    source_blob_path: "incoming/broken-video.mp4",
    source_size_bytes: 120,
    source_content_type: "video/mp4",
    attempt_count: 1
  };
  const pool = fakePool(job);
  try {
    const result = await inspectOneUploadedMedia({
      pool,
      config: {
        tempDir: root,
        maxInputBytes: 200 * 1024 * 1024,
        maxJobDurationSeconds: 3 * 60 * 60,
        blobReadWriteToken: "test-token"
      },
      workerId: "inspector-test",
      dependencies: {
        downloadPrivateBlob: async ({ destination }) => {
          await writeFile(destination, "broken-media");
          return { sizeBytes: 120, contentType: "video/mp4" };
        },
        probeMedia: async () => { throw new Error("ffprobe_failed"); }
      }
    });
    assert.deepEqual(result, { jobId: "job-3", failed: false });
    assert.ok(pool.calls.some(call => call.sql.includes("status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END")));
    assert.ok(pool.calls.some(call => call.values?.[2] === "ffprobe_failed"));
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported media type is rejected before downloading", async () => {
  const root = await mkdtemp(join(tmpdir(), "captionmitra-inspection-"));
  const job = {
    id: "job-4",
    source_blob_path: "incoming/unsupported.bin",
    source_size_bytes: 120,
    source_content_type: "application/octet-stream",
    attempt_count: 1
  };
  const pool = fakePool(job);
  let downloaded = false;
  try {
    const result = await inspectOneUploadedMedia({
      pool,
      config: {
        tempDir: root,
        maxInputBytes: 200 * 1024 * 1024,
        maxJobDurationSeconds: 3 * 60 * 60,
        blobReadWriteToken: "test-token"
      },
      workerId: "inspector-test",
      dependencies: {
        downloadPrivateBlob: async () => { downloaded = true; throw new Error("must_not_download"); },
        probeMedia: async () => { throw new Error("must_not_probe"); }
      }
    });
    assert.deepEqual(result, { jobId: "job-4", failed: false });
    assert.equal(downloaded, false);
    assert.ok(pool.calls.some(call => call.values?.[2] === "unsupported_media_type"));
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
