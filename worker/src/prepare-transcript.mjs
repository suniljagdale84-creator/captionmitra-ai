import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withPreparedMedia } from "./process-media.mjs";
import { transcribeChunks } from "./transcription.mjs";
import { segmentsToSrt } from "./subtitles.mjs";

export async function prepareTranscriptFiles(job, config, dependencies = {}) {
  const transcribe = dependencies.transcribeChunks || transcribeChunks;
  const write = dependencies.writeFile || writeFile;

  return withPreparedMedia(job, config, async ({ chunks, metadata }) => {
    const transcript = await transcribe(chunks, {
      apiKey: config.openAiApiKey,
      model: config.transcriptionModel || "whisper-1",
      maxAttempts: 3,
      chunkSeconds: 8 * 60,
      fetchImpl: dependencies.fetchImpl || fetch
    });

    const srt = segmentsToSrt(transcript.segments);
    if (!srt) throw new Error("Transcription returned no subtitle segments");

    const outputDir = join(config.tempDir, "captionmitra-output");
    const jobOutputDir = join(outputDir, String(job.id));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(jobOutputDir, { recursive: true, mode: 0o700 });
    const srtPath = join(jobOutputDir, "captions.srt");
    const txtPath = join(jobOutputDir, "transcript.txt");

    try {
      await write(srtPath, srt, { encoding: "utf8", mode: 0o600 });
      await write(txtPath, transcript.text + "\n", { encoding: "utf8", mode: 0o600 });
      return {
        srtPath,
        txtPath,
        durationSeconds: metadata.durationSeconds,
        segmentCount: transcript.segments.length,
        transcriptText: transcript.text
      };
    } catch (error) {
      const { rm } = await import("node:fs/promises");
      await rm(jobOutputDir, { recursive: true, force: true });
      throw error;
    }
  }, dependencies.mediaDependencies || {});
}
