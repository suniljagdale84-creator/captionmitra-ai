import { withPreparedMedia } from "./process-media.mjs";
import { transcribeChunks } from "./transcription.mjs";
import { translateTranscriptSegments } from "./translation.mjs";
import { segmentsToSrt } from "./subtitles.mjs";

export async function prepareTranscript(job, config, dependencies = {}) {
  const transcribe = dependencies.transcribeChunks || transcribeChunks;
  const translate = dependencies.translateTranscriptSegments || translateTranscriptSegments;

  return withPreparedMedia(job, config, async ({ chunks, metadata }) => {
    const transcript = await transcribe(chunks, {
      apiKey: config.openAiApiKey,
      model: config.transcriptionModel || "whisper-1",
      maxAttempts: 3,
      chunkSeconds: 8 * 60,
      fetchImpl: dependencies.fetchImpl || fetch
    });

    let outputSegments = transcript.segments;
    let outputText = transcript.text.trim();
    const targetLanguage = typeof job.output_language === "string" ? job.output_language.trim() : "";

    if (targetLanguage && !["original", "source", "same"].includes(targetLanguage.toLowerCase())) {
      outputSegments = await translate(transcript.segments, {
        apiKey: config.openAiApiKey,
        targetLanguage,
        model: config.translationModel || "gpt-4o-mini",
        maxAttempts: 3,
        fetchImpl: dependencies.fetchImpl || fetch
      });
      outputText = outputSegments.map((segment) => segment.text).join(" ").trim();
    }

    const srt = segmentsToSrt(outputSegments);
    if (!srt || !outputText) throw new Error("Caption generation returned no usable text or subtitle segments");

    return {
      srt,
      txt: outputText + "\n",
      durationSeconds: metadata.durationSeconds,
      segmentCount: outputSegments.length,
      transcriptText: outputText,
      sourceLanguage: transcript.language || null,
      outputLanguage: targetLanguage || "original"
    };
  }, dependencies.mediaDependencies || {});
}
