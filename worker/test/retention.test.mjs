import test from "node:test";
import assert from "node:assert/strict";
import { cleanupExpiredJobs } from "../src/retention.mjs";

test("requires database and private Blob credentials", async () => {
  await assert.rejects(() => cleanupExpiredJobs({}), /PostgreSQL pool/);
  await assert.rejects(() => cleanupExpiredJobs({ pool: { connect() {} } }), /Blob read\/write token/);
});

test("validates bounded cleanup batch size", async () => {
  await assert.rejects(() => cleanupExpiredJobs({ pool: { connect() {} }, blobToken: "test", batchSize: 101 }), /batch size/);
});
