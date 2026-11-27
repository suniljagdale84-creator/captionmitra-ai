import test from "node:test";
import assert from "node:assert/strict";
import { translateSegmentBatch, translateTranscriptSegments } from "../src/translation.mjs";

test("translates ordered segments and preserves exact segment count", async () => {
  const translated = await translateSegmentBatch(["Hello", "How are you?"], {
    apiKey: "test-key",
    targetLanguage: "Hindi",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-4o-mini");
      assert.deepEqual(JSON.parse(body.messages[1].content).segments, ["Hello", "How are you?"]);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ translations: ["नमस्ते", "आप कैसे हैं?"] }) } }]
      }), { status: 200 });
    }
  });
  assert.deepEqual(translated, ["नमस्ते", "आप कैसे हैं?"]);
});

test("rejects mismatched translation count", async () => {
  await assert.rejects(() => translateSegmentBatch(["One", "Two"], {
    apiKey: "test-key", targetLanguage: "Hindi",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ translations: ["एक"] }) } }]
    }), { status: 200 })
  }), /segment count/);
});

test("retries temporary provider errors", async () => {
  let calls = 0;
  const result = await translateSegmentBatch(["Hello"], {
    apiKey: "test-key", targetLanguage: "Hindi",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 429 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ translations: ["नमस्ते"] }) } }]
      }), { status: 200 });
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, ["नमस्ते"]);
});

test("translates in batches while preserving timestamps and order", async () => {
  let callCount = 0;
  const segments = Array.from({ length: 41 }, (_, i) => ({
    start: i, end: i + 0.5, text: `line ${i}`
  }));
  const result = await translateTranscriptSegments(segments, {
    apiKey: "test-key", targetLanguage: "English",
    fetchImpl: async (_url, options) => {
      callCount += 1;
      const request = JSON.parse(JSON.parse(options.body).messages[1].content);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          translations: request.segments.map((s) => `translated ${s}`)
        }) } }]
      }), { status: 200 });
    }
  });
  assert.equal(callCount, 2);
  assert.equal(result.length, 41);
  assert.equal(result[40].start, 40);
  assert.equal(result[40].text, "translated line 40");
});
