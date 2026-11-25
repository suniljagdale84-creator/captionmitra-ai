import { withPreparedMedia } from "./process-media.mjs";
import { transcribeChunks } from "./transcription.mjs";
import { translateTranscriptSegments } from "./translation.mjs";
import { normalizeOutputLanguage } from "./languages.mjs";
import { segmentsToSrt } from "./subtitles.mjs";

export async function prepareTranscript(job, config, dependencies = {}) {
  const transcribe = dependencies.transcribeChunks || transcribeChunks;
  const translate = dependencies.translateTranscriptSegments || translateTranscriptSegments;

  return withPreparedMedia(job, config, async ({ chunks, metadata }) => {
    await dependencies.onStage?.("transcribing");
    const transcript = await transcribe(chunks, {
      apiKey: config.openAiApiKey,
      model: config.transcriptionModel || "whisper-1",
      maxAttempts: 3,
      chunkSeconds: 8 * 60,
      fetchImpl: dependencies.fetchImpl || fetch
    });
    const targetLanguage = normalizeOutputLanguage(job.output_language);
    await dependencies.onStage?.("translating");
    const outputSegments = await translate(transcript.segments, {
      apiKey: config.openAiApiKey,
      targetLanguage,
      model: config.translationModel || "gpt-4o-mini",
      maxAttempts: 3,
      fetchImpl: dependencies.fetchImpl || fetch
    });
    const outputText = outputSegments.map((segment) => segment.text).join(" ").trim();
    const srt = segmentsToSrt(outputSegments);
    if (!srt || !outputText) throw new Error("Caption generation returned no usable text or subtitle segments");
    return {
      srt, txt: outputText + "\n",
      durationSeconds: metadata.durationSeconds,
      segmentCount: outputSegments.length,
      transcriptText: outputText,
      sourceLanguage: transcript.language || null,
      outputLanguage: targetLanguage
    };
  }, dependencies.mediaDependencies || {});
}
