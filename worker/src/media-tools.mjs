import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

const ALLOWED_MEDIA_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".mp3", ".wav", ".m4a"]);

export async function assertValidMediaFile(filePath, maxBytes = 200 * 1024 * 1024) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) {
    throw new Error("Media file size is invalid");
  }
  return info;
}

export function runMediaCommand(binary, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Media command timed out"));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-64_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-64_000); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(`Media command failed (exit ${code}): ${stderr.slice(-2000)}`));
    });
  });
}

export async function probeMedia(filePath) {
  await assertValidMediaFile(filePath);
  const { stdout } = await runMediaCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:format_name",
    "-of", "json",
    filePath
  ]);
  const metadata = JSON.parse(stdout);
  const durationSeconds = Number(metadata?.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3 * 60 * 60) {
    throw new Error("Media duration is unsupported");
  }
  return { durationSeconds, formatName: String(metadata.format.format_name || "") };
}

export async function extractAudio(inputPath, outputPath) {
  await assertValidMediaFile(inputPath);
  return runMediaCommand("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "64k", outputPath
  ], { timeoutMs: 30 * 60 * 1000 });
}
