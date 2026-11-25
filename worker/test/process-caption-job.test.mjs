import test from "node:test";
import assert from "node:assert/strict";
import { processCaptionJob } from "../src/process-caption-job.mjs";

const job = { id: "f9c2c41e-8d9e-4d4b-9b2c-8aab6e9f1a11" };
const config = { blobReadWriteToken: "test-private-token" };

test("creates private SRT/TXT result and completes the owned job", async () => {
  let uploaded, completed;
  const result = await processCaptionJob(job, "worker-1", config, {
    pool: {},
    prepareTranscript: async () => ({
      srt: "1\\n00:00:00,000 --> 00:00:01,000\\nNamaste\\n",
      txt: "Namaste\\n",
      sourceLanguage: "hi",
      outputLanguage: "Hindi",
      durationSeconds: 1,
      segmentCount: 1
    }),
    putBlob: async (pathname, body, options) => {
      uploaded = { pathname, body: JSON.parse(body), options };
      return { pathname };
    },
    completeJob: async (...args) => { completed = args; return true; }
  });
  assert.equal(uploaded.options.access, "private");
  assert.equal(uploaded.body.files.srt.content.includes("Namaste"), true);
  assert.equal(uploaded.body.files.txt.content, "Namaste\\n");
  assert.equal(completed[1], job.id);
  assert.equal(completed[2], "worker-1");
  assert.equal(completed[3], uploaded.pathname);
  assert.equal(result.outputPath, uploaded.pathname);
});

test("deletes orphaned result if job ownership was lost", async () => {
  let deleted = false;
  await assert.rejects(processCaptionJob(job, "worker-1", config, {
    pool: {},
    prepareTranscript: async () => ({
      srt: "caption",
      txt: "caption",
      sourceLanguage: "en",
      outputLanguage: "English",
      durationSeconds: 1,
      segmentCount: 1
    }),
    putBlob: async pathname => ({ pathname }),
    completeJob: async () => false,
    deleteBlob: async () => { deleted = true; }
  }), /ownership was lost/);
  assert.equal(deleted, true);
});

test("rejects oversized result before uploading", async () => {
  let uploadCalled = false;
  await assert.rejects(processCaptionJob(job, "worker-1", config, {
    pool: {},
    prepareTranscript: async () => ({
      srt: "x".repeat(3 * 1024 * 1024),
      txt: "y".repeat(3 * 1024 * 1024),
      durationSeconds: 1,
      segmentCount: 1
    }),
    putBlob: async () => { uploadCalled = true; }
  }), /size limit/);
  assert.equal(uploadCalled, false);
});
