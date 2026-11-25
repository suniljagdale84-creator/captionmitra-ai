import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkerConfig } from "../src/config.mjs";

const validEnv = {
  WORKER_SHARED_SECRET: "x".repeat(40),
  OPENAI_API_KEY: "test-key",
  DATABASE_URL: "postgres://localhost/test",
  BLOB_READ_WRITE_TOKEN: "test-token"
};

test("loads bounded worker configuration", () => {
  const config = loadWorkerConfig(validEnv);
  assert.equal(config.concurrency, 1);
  assert.equal(config.maxInputBytes, 209715200);
});

test("rejects missing secrets", () => {
  assert.throws(() => loadWorkerConfig({}), /Missing required worker configuration/);
});

test("rejects weak worker shared secret", () => {
  assert.throws(() => loadWorkerConfig({ ...validEnv, WORKER_SHARED_SECRET: "short" }), /at least 32 bytes/);
});

test("rejects unsafe concurrency", () => {
  assert.throws(() => loadWorkerConfig({ ...validEnv, WORKER_CONCURRENCY: "3" }), /between 1 and 2/);
});
