/**
 * Read a request stream without buffering more than maxBytes in memory.
 */
export async function readLimitedBody(body, maxBytes) {
  if (!body || typeof body.getReader !== "function" ||
      !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("A readable body and positive byte limit are required");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request_body_too_large").catch(() => {});
        throw new RangeError("Request body exceeds the configured limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
