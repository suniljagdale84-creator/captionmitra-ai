import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { downloadPrivateBlob } from "./blob-storage.mjs";
import { probeMedia, extractAudio, splitAudioIntoChunks } from "./media-tools.mjs";

const ALLOWED_CONTENT_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/x-matroska", "video/webm", "video/x-msvideo",
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/flac", "audio/webm"
]);

export async function withPreparedMedia(job, config, consumeChunks, dependencies = {}) {
  if (!job || typeof job.source_blob_path !== "string" ||
      typeof job.source_content_type !== "string" ||
      !ALLOWED_CONTENT_TYPES.has(job.source_content_type.toLowerCase())) {
    throw new Error("Unsupported job media metadata");
  }
  if (!Number.isSafeInteger(Number(job.source_size_bytes)) ||
      Number(job.source_size_bytes) < 1 || Number(job.source_size_bytes) > config.maxInputBytes) {
    throw new Error("Job source size is invalid");
  }
  if (typeof consumeChunks !== "function") throw new Error("Chunk consumer callback is required");

  const makeTempDir = dependencies.mkdtemp || mkdtemp;
  const removeTemp = dependencies.rm || rm;
  const download = dependencies.downloadPrivateBlob || downloadPrivateBlob;
  const probe = dependencies.probeMedia || probeMedia;
  const extract = dependencies.extractAudio || extractAudio;
  const split = dependencies.splitAudioIntoChunks || splitAudioIntoChunks;

  await mkdir(config.tempDir, { recursive: true, mode: 0o700 });
  const workDir = await makeTempDir(join(config.tempDir, "captionmitra-job-"));
  try {
    const sourcePath = join(workDir, "source.media");
    const audioPath = join(workDir, "audio.mp3");
    const chunksDir = join(workDir, "chunks");

    await dependencies.onStage?.("downloading");
    const downloaded = await download({
      pathname: job.source_blob_path,
      token: config.blobReadWriteToken,
      destination: sourcePath,
      tempDir: config.tempDir,
      maxBytes: config.maxInputBytes
    });

    if (downloaded.contentType && downloaded.contentType.toLowerCase() !== job.source_content_type.toLowerCase()) {
      throw new Error("Uploaded media content type does not match the stored job record");
    }
    if (downloaded.sizeBytes !== Number(job.source_size_bytes)) {
      throw new Error("Uploaded media size does not match the stored job record");
    }

    await dependencies.onStage?.("extracting_audio");
    const metadata = await probe(sourcePath);
    if (metadata.durationSeconds > config.maxJobDurationSeconds) {
      throw new Error("Media duration exceeds the supported limit");
    }
    if (job.media_duration_seconds != null &&
        Math.abs(Number(job.media_duration_seconds) - metadata.durationSeconds) > 2) {
      throw new Error("Media duration does not match the stored job record");
    }

    await extract(sourcePath, audioPath);
    const chunks = await split(audioPath, chunksDir, {
      tempDir: config.tempDir,
      chunkSeconds: 8 * 60,
      maxChunkBytes: 20 * 1024 * 1024
    });

    return await consumeChunks({
      job,
      metadata,
      chunks,
      totalDurationSeconds: metadata.durationSeconds
    });
  } finally {
    await removeTemp(workDir, { recursive: true, force: true });
  }
}
