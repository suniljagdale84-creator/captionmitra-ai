import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { prepareTranscript } from "./prepare-transcript.mjs";
import { completeJob } from "./queue.mjs";

const LANGUAGES = new Set(["Hindi", "Marathi", "English", "Hinglish"]);

export async function processAndStoreJob(job, workerId, { pool, config, prepare = prepareTranscript, putBlob = put, deleteBlob = del } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required");
  if (!config?.blobReadWriteToken) throw new Error("Blob storage token is required");
  if (!job || typeof job.id !== "string" || !/^[0-9a-f-]{36}$/i.test(job.id)) throw new Error("Invalid job identifier");
  if (!LANGUAGES.has(job.output_language)) throw new Error("Unsupported output language");
  const output = await prepare(job, config);
  if (!output || typeof output.srt !== "string" || !output.srt.trim() || typeof output.txt !== "string" || !output.txt.trim() || !Number.isInteger(output.segmentCount) || output.segmentCount < 1) throw new Error("Caption output is incomplete");
  const pathname = `results/${job.id}/${randomUUID()}.json`;
  const payload = { version: 1, jobId: job.id, outputLanguage: job.output_language, durationSeconds: output.durationSeconds, segmentCount: output.segmentCount, files: { srt: { filename: "captions.srt", contentType: "application/x-subrip", content: output.srt }, txt: { filename: "captions.txt", contentType: "text/plain; charset=utf-8", content: output.txt } } };
  const blob = await putBlob(pathname, JSON.stringify(payload), { access: "private", token: config.blobReadWriteToken, contentType: "application/json", addRandomSuffix: false });
  if (!blob || blob.pathname !== pathname) throw new Error("Private result upload did not return the expected pathname");
  const completed = await completeJob(pool, job.id, workerId, blob.pathname);
  if (!completed) { await deleteBlob(blob.pathname, { access: "private", token: config.blobReadWriteToken }).catch(() => {}); throw new Error("Job lease was lost before completion could be recorded"); }
  return { jobId: job.id, resultPath: blob.pathname, segmentCount: output.segmentCount };
}
