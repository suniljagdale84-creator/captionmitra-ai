# CaptionMitra Worker (pre-deployment foundation)

Separate Node.js 20+ service intended for the future Ubuntu VPS. This code is not deployed and does not yet process customer jobs.

## Included
- PostgreSQL connection pool with bounded connections and timeouts.
- Queue claim operation using PostgreSQL transactions and `FOR UPDATE SKIP LOCKED`.
- Worker-owned job lease checks before completion or retry.
- Atomic retry state changes and job-event history.
- Retry backoff and bounded retry count from the database schema.
- Loopback-only HTTP health/status API with bearer-secret authentication for internal status.
- Safe FFprobe metadata inspection and FFmpeg audio extraction helpers.
- Audio extraction to mono 16 kHz / 64 kbps MP3 and eight-minute segment splitting, with each chunk checked against a 20 MB ceiling.
- A media preparation wrapper that validates stored job metadata, downloads private Blob media, probes actual duration, extracts and splits audio, and removes its temporary job directory in a `finally` block.
- Strict configuration checks and unit tests.

## Environment (never commit real values)
- `WORKER_SHARED_SECRET`: random secret, at least 32 bytes.
- `DATABASE_URL`: private PostgreSQL connection string.
- `BLOB_READ_WRITE_TOKEN`: server-only Blob token.
- `OPENAI_API_KEY`: server-only API key.
- Optional: `WORKER_PORT` (default 8080), `WORKER_CONCURRENCY` (1–2), `WORKER_TEMP_DIR`.

## Checks
```sh
npm install
npm test
npm run check
```

## Current API
- `GET /health`: checks PostgreSQL connectivity.
- `GET /internal/worker/status`: bearer-secret protected queue count.
- The service binds to `127.0.0.1`; it is not intended to be directly exposed to the public internet.

## Not implemented
- No queue polling loop or automatic job execution.
- Private Vercel Blob downloader using the SDK `get(pathname, { access: 'private', token })`, with pathname validation, streaming byte limits, and restrictive local file permissions.
- Queue polling loop primitive with one/two worker slots and retry handling is drafted, but intentionally not enabled by the HTTP server until a real processor is implemented.
- Timestamped OpenAI Whisper transcription is implemented with bounded retries and sequential chunk processing. SRT and plain-text transcript content are generated, with chunk-relative timestamps offset into the full-video timeline.
- Translation uses the job's stored `output_language`, processes up to 40 subtitle lines per request, validates the exact output line count, and preserves each segment's original timestamps. `original` / `source` / `same` skips translation.
- The combined preparation helper returns generated SRT/TXT content in memory and removes temporary media files. It is not yet connected to the live queue consumer or private result upload.
- No payment verification or payment-triggered enqueue endpoint.
- No lease-expiry recovery scheduler or Blob/local-file cleanup scheduler.
- No live PostgreSQL integration tests or deployment.

Do not deploy this worker or send customer jobs to it. Only server-verified paid jobs may be processed once the remaining controls are implemented and tested. Use a TLS reverse proxy/firewall and authenticated service-to-service calls before any deployment.
