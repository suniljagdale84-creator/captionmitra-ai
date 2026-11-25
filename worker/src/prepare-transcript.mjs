import { withPreparedMedia } from "./process-media.mjs";
import { transcribeChunks } from "./transcription.mjs";
import { segmentsToSrt } from "./subtitles.mjs";

export async function prepareTranscript(job, config, dependencies = {}) {
  const transcribe = dependencies.transcribeChunks || transcribeChunks;

  return withPreparedMedia(job, config, async ({ chunks, metadata }) => {
    const transcript = await transcribe(chunks, {
      apiKey: config.openAiApiKey,
      model: config.transcriptionModel || "whisper-1",
      maxAttempts: 3,
      chunkSeconds: 8 * 60,
      fetchImpl: dependencies.fetchImpl || fetch
    });

    const srt = segmentsToSrt(transcript.segments);
    const txt = transcript.text.trim();
    if (!srt || !txt) throw new Error("Transcription returned no usable text or subtitle segments");

    return {
      srt,
      txt: txt + "\n",
      durationSeconds: metadata.durationSeconds,
      segmentCount: transcript.segments.length,
      transcriptText: txt
    };
  }, dependencies.mediaDependencies || {});
}
