const REQUIRED = ["WORKER_SHARED_SECRET", "OPENAI_API_KEY", "DATABASE_URL", "BLOB_READ_WRITE_TOKEN"];

export function loadWorkerConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key] || !env[key].trim());
  if (missing.length) {
    throw new Error(`Missing required worker configuration: ${missing.join(", ")}`);
  }

  const secret = env.WORKER_SHARED_SECRET;
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("WORKER_SHARED_SECRET must be at least 32 bytes");
  }

  const port = Number(env.WORKER_PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("WORKER_PORT must be a valid TCP port");
  }

  const concurrency = Number(env.WORKER_CONCURRENCY ?? "1");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new Error("WORKER_CONCURRENCY must be an integer between 1 and 2");
  }

  return Object.freeze({
    databaseUrl: env.DATABASE_URL,
    blobReadWriteToken: env.BLOB_READ_WRITE_TOKEN,
    openAiApiKey: env.OPENAI_API_KEY,
    sharedSecret: secret,
    concurrency,
    port,
    tempDir: env.WORKER_TEMP_DIR || "/var/tmp/captionmitra",
    maxInputBytes: 200 * 1024 * 1024,
    maxJobDurationSeconds: 3 * 60 * 60
  });
}
