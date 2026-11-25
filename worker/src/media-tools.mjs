import { spawn } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { resolve, sep, join } from "node:path";

export async function assertValidMediaFile(filePath, maxBytes = 200 * 1024 * 1024) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) {
    throw new Error("Media file size is invalid");
  }
  return info;
}

export function runMediaCommand(binary, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolvePromise(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Media command timed out"));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-64_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-64_000); });
    child.on("error", () => finish(new Error("Media command could not be started")));
    child.on("close", (code) => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(`Media command failed (exit ${code}): ${stderr.slice(-2000)}`));
    });
  });
}

export async function probeMedia(filePath, runCommand = runMediaCommand) {
  await assertValidMediaFile(filePath);
  const { stdout } = await runCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:format_name",
    "-of", "json",
    filePath
  ], { timeoutMs: 30_000 });
  const metadata = JSON.parse(stdout);
  const durationSeconds = Number(metadata?.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3 * 60 * 60) {
    throw new Error("Media duration is unsupported");
  }
  return { durationSeconds, formatName: String(metadata.format.format_name || "") };
}

export async function extractAudio(inputPath, outputPath, runCommand = runMediaCommand) {
  await assertValidMediaFile(inputPath);
  await runCommand("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "64k", outputPath
  ], { timeoutMs: 30 * 60 * 1000 });
  return assertValidMediaFile(outputPath, 150 * 1024 * 1024);
}

export async function splitAudioIntoChunks(audioPath, outputDir, {
  chunkSeconds = 8 * 60,
  maxChunkBytes = 20 * 1024 * 1024,
  tempDir,
  runCommand = runMediaCommand
} = {}) {
  if (!Number.isInteger(chunkSeconds) || chunkSeconds < 60 || chunkSeconds > 10 * 60) {
    throw new Error("Audio chunk duration must be between 60 and 600 seconds");
  }
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1 || maxChunkBytes > 24 * 1024 * 1024) {
    throw new Error("Audio chunk byte limit is invalid");
  }

  const root = resolve(tempDir || "");
  const directory = resolve(outputDir);
  if (!tempDir || directory === root || !directory.startsWith(root + sep)) {
    throw new Error("Chunk directory must be inside the worker temp directory");
  }

  await assertValidMediaFile(audioPath, 150 * 1024 * 1024);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await readdir(directory)).length !== 0) {
    throw new Error("Audio chunk directory must be empty");
  }

  const pattern = join(directory, "chunk-%03d.mp3");
  await runCommand("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", audioPath,
    "-map", "0:a:0",
    "-f", "segment",
    "-segment_time", String(chunkSeconds),
    "-reset_timestamps", "1",
    "-c", "copy",
    pattern
  ], { timeoutMs: 30 * 60 * 1000 });

  const names = (await readdir(directory))
    .filter((name) => /^chunk-\d{3}\.mp3$/.test(name))
    .sort();
  if (names.length < 1 || names.length > 24) {
    throw new Error("Audio chunk count is invalid");
  }

  const chunks = [];
  for (const name of names) {
    const path = join(directory, name);
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > maxChunkBytes) {
      throw new Error("Audio chunk exceeds the configured size limit");
    }
    chunks.push({ path, sizeBytes: info.size, index: chunks.length });
  }
  return chunks;
}
