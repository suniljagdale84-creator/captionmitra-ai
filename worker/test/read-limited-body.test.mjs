import test from "node:test";
import assert from "node:assert/strict";
import { readLimitedBody } from "../../src/lib/read-limited-body.mjs";

test("reads a request body within its byte limit", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"event":'));
      controller.enqueue(new TextEncoder().encode('"payment.captured"}'));
      controller.close();
    }
  });
  assert.equal(await readLimitedBody(body, 100), '{"event":"payment.captured"}');
});

test("rejects a request body larger than the configured byte limit", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.close();
    }
  });
  await assert.rejects(readLimitedBody(body, 10), RangeError);
});

test("rejects malformed UTF-8 rather than silently replacing bytes", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0xc3, 0x28]));
      controller.close();
    }
  });
  await assert.rejects(readLimitedBody(body, 10), TypeError);
});
