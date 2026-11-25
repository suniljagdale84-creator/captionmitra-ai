import test from "node:test";
import assert from "node:assert/strict";
import { verifyDurationAndPrice } from "../src/verify-duration-price.mjs";

test("stores verified FFprobe duration and prorata amount", async () => {
  let queryArgs;
  const pool = { query: async (_sql, args) => {
    queryArgs = args;
    return { rows: [{ id: "job-1", media_duration_seconds: "241.25", amount_paise: 1207, currency: "INR", status: "awaiting_payment" }] };
  }};
  const result = await verifyDurationAndPrice(pool, "job-1", "/tmp/video.mp4",
    async () => ({ durationSeconds: 241.25, formatName: "mov,mp4" }));
  assert.equal(queryArgs[1], 241.25);
  assert.equal(queryArgs[2], 1207);
  assert.equal(result.amountPaise, 1207);
  assert.equal(result.mediaDurationSeconds, 241.25);
});

test("rejects a job that is not in an upload/payment state", async () => {
  const pool = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    verifyDurationAndPrice(pool, "job-2", "/tmp/video.mp4", async () => ({ durationSeconds: 300 })),
    /not eligible/
  );
});

test("rejects invalid probed durations before writing to the database", async () => {
  let called = false;
  const pool = { query: async () => { called = true; return { rows: [] }; } };
  await assert.rejects(
    verifyDurationAndPrice(pool, "job-3", "/tmp/video.mp4", async () => ({ durationSeconds: 0 })),
    /Invalid media duration/
  );
  assert.equal(called, false);
});
