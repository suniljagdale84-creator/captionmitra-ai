# CaptionMitra Worker (foundation only)

This is a separate Node.js 20 worker package intended for the future Ubuntu VPS. It is not deployed and does not yet accept jobs or connect to a database.

## Included
- Strict environment configuration validation.
- A 200 MB input-size ceiling and a three-hour media-duration ceiling.
- Safe child-process invocation without a shell.
- Bounded command output and execution timeout.
- FFprobe metadata inspection and FFmpeg mono/16 kHz audio extraction helpers.
- Unit tests for configuration and concurrency limits.

## Required environment (never commit real values)
- `WORKER_SHARED_SECRET`: random secret, at least 32 bytes.
- `DATABASE_URL`: private PostgreSQL connection string.
- `BLOB_READ_WRITE_TOKEN`: server-only Vercel Blob token with least required scope.
- `OPENAI_API_KEY`: server-only API key.
- Optional: `WORKER_CONCURRENCY` (1–2; default 1), `WORKER_TEMP_DIR`.

## Run checks locally
```sh
npm test
npm run check
```

## Not implemented yet
No HTTP listener, job polling, database adapter, Blob downloader, payment integration, transcription, translation, subtitle renderer, or cleanup scheduler exists yet. Do not deploy this package or send customer jobs to it until those controls and integration tests are complete.

The worker must only process server-verified paid jobs. It must authenticate every internal request, use a durable database queue, enforce disk/time limits, and delete temporary files in a guaranteed cleanup path plus scheduled crash recovery.
