import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { prepareTranscript } from "./prepare-transcript.mjs";
import { completeJob } from "./queue.mjs";

/**
 * Download -> extract -> transcribe -> translate -> package SRT/TXT -> private Blob.
 * The source file is not deleted here; durable cleanup handles it after the
 * job reaches a terminal state.
 */
export async function processCaptionJob(job, workerId, config, dependencies = {}) {
  const prepare = dependencies.prepareTranscript || prepareTranscript;
  const upload = dependencies.putBlob || put;
  const deleteBlob = dependencies.deleteBlob || del;
  const markComplete = dependencies.completeJob || completeJob;

  const prepared = await prepare(job, config, dependencies.prepareDependencies || {});
  const payload = JSON.stringify({
    version: 1,
    jobId: job.id,
    sourceLanguage: prepared.sourceLanguage,
    outputLanguage: prepared.outputLanguage,
    durationSeconds: prepared.durationSeconds,
    segmentCount: prepared.segmentCount,
    files: {
      srt: { content: prepared.srt },
      txt: { content: prepared.txt }
    }
  });

  if (Buffer.byteLength(payload, "utf8") > 5 * 1024 * 1024) {
    throw new Error("Caption output exceeds the supported size limit");
  }

  const pathname = `captionmitra/results/${job.id}/${randomUUID()}.json`;
  const stored = await upload(pathname, payload, {
    access: "private",
    token: config.blobReadWriteToken,
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false
  });

  const resultPath = stored?.pathname;
  if (typeof resultPath !== "string" || !resultPath) {
    throw new Error("Private result storage did not return a pathname");
  }

  const completed = await markComplete(
    dependencies.pool,
    job.id,
    workerId,
    resultPath
  );

  if (!completed) {
    await deleteBlob(resultPath, {
      access: "private",
      token: config.blobReadWriteToken
    }).catch(() => {});
    throw new Error("Job ownership was lost before completion");
  }

  return {
    jobId: job.id,
    outputPath: resultPath,
    segmentCount: prepared.segmentCount
  };
}
