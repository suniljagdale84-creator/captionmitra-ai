import test from "node:test";
import assert from "node:assert/strict";
import { processAndStoreJob } from "../src/store-results.mjs";

const job = { id: "123e4567-e89b-12d3-a456-426614174000", output_language: "Marathi" };
const config = { blobReadWriteToken: "test-token" };
test("rejects unsupported language before processing", async () => {
  await assert.rejects(() => processAndStoreJob({ ...job, output_language: "French" }, "worker-1", { pool: { connect() {} }, config, prepare: async () => { throw new Error("must not run"); } }), /Unsupported output language/);
});
test("rejects missing database pool before processing", async () => {
  await assert.rejects(() => processAndStoreJob(job, "worker-1", { config, prepare: async () => ({}) }), /PostgreSQL pool/);
});
