import { readFile } from "node:fs/promises";

const API_URL = "https://api.openai.com/v1/audio/transcriptions";
function retryable(status) { return status === 408 || status === 409 || status === 429 || status >= 500; }

export async function transcribeAudioChunk(chunk, { apiKey, model = "whisper-1", language, fetchImpl = fetch, maxAttempts = 3 } = {}) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  if (!chunk || typeof chunk.path !== "string" || !Number.isSafeInteger(chunk.sizeBytes) || chunk.sizeBytes < 1 || chunk.sizeBytes > 20 * 1024 * 1024) {
    throw new Error("Invalid transcription audio chunk");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4) throw new Error("Invalid transcription retry count");
  const bytes = await readFile(chunk.path);
  if (bytes.length !== chunk.sizeBytes) throw new Error("Audio chunk size changed before transcription");

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "audio/mpeg" }), `chunk-${chunk.index}.mp3`);
    form.set("model", model);
    form.set("response_format", "verbose_json");
    form.set("timestamp_granularities[]", "segment");
    if (language) form.set("language", language);
    let response;
    try {
      response = await fetchImpl(API_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(180_000) });
    } catch {
      lastError = new Error("Transcription service could not be reached");
      if (attempt < maxAttempts) { await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1)))); continue; }
      throw lastError;
    }
    if (!response.ok) {
      const status = response.status;
      if (retryable(status) && attempt < maxAttempts) {
        await response.body?.cancel().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
        continue;
      }
      throw new Error(`Transcription request failed (HTTP ${status})`);
    }
    const data = await response.json();
    if (!data || typeof data.text !== "string" || !Array.isArray(data.segments)) throw new Error("Transcription response did not contain timestamped segments");
    const segments = data.segments.map((segment) => {
      const start = Number(segment.start), end = Number(segment.end);
      const text = typeof segment.text === "string" ? segment.text.trim() : "";
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !text) throw new Error("Transcription response contains an invalid segment");
      return { start, end, text };
    });
    return { text: data.text, segments, language: data.language || null };
  }
  throw lastError || new Error("Transcription failed");
}

export async function transcribeChunks(chunks, { apiKey, model = "whisper-1", language, fetchImpl = fetch, maxAttempts = 3, chunkSeconds = 8 * 60 } = {}) {
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > 24) throw new Error("Invalid audio chunk list");
  const allSegments = [], texts = [], languageCounts = new Map();
  for (let index = 0; index < chunks.length; index += 1) {
    if (chunks[index].index !== index) throw new Error("Audio chunks must be in sequential order");
    const result = await transcribeAudioChunk(chunks[index], { apiKey, model, language, fetchImpl, maxAttempts });
    const offset = index * chunkSeconds;
    for (const segment of result.segments) allSegments.push({ start: segment.start + offset, end: segment.end + offset, text: segment.text });
    texts.push(result.text);
    if (result.language) languageCounts.set(result.language, (languageCounts.get(result.language) || 0) + 1);
  }
  const detectedLanguage = [...languageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { text: texts.join("\n").trim(), segments: allSegments, language: detectedLanguage };
}
