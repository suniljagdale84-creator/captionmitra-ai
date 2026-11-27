# CaptionMitra Worker (pre-deployment)

Separate Node.js 20+ service intended for the future Ubuntu VPS. The server starts the pre-payment media-inspection loop, paid-job processing loop, and durable Blob cleanup scheduler. This worker has **not** been deployed or connected to a live customer environment.

## Included

- PostgreSQL connection pool with bounded connections and timeouts.
- Pre-payment inspection: private Blob download, FFprobe duration check, exact-duration price calculation, and temporary-directory cleanup.
- Inspection leases with heartbeat and stale-lease recovery: after a five-minute stale lease, attempts below three return to pending; exhausted attempts are marked failed.
- Paid-job polling. Queue claims require verified payment and a provider payment ID, so unpaid jobs are not eligible.
- PostgreSQL queue claims using transactions and `FOR UPDATE SKIP LOCKED`.
- Worker-owned leases, processing heartbeats, stale paid-job lease recovery, retry backoff and bounded retry count.
- Caption processing: private Blob download, FFmpeg audio extraction, eight-minute audio chunks (each checked against a 20 MB ceiling), timestamped transcription, translation, SRT/TXT generation and private result upload.
- Temporary media directory removal in `finally` blocks.
- Durable, retryable private Blob cleanup for eligible source and expired result objects.
- Loopback-only HTTP health/status and customer status/download endpoints. Internal worker status and manual cleanup endpoints require the shared bearer secret.
- Strict configuration checks and automated unit/SQL tests.

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

## HTTP API

- `GET /health`: checks PostgreSQL connectivity.
- `GET /internal/worker/status`: bearer-secret protected queue and cleanup status.
- `POST /internal/worker/cleanup/run`: bearer-secret protected manual cleanup trigger.
- `GET /api/customer/jobs/:id`: customer job status using the customer access token header.
- `GET /api/customer/jobs/:id/download?format=srt|txt`: private result download using the customer access token header.

The service binds to `127.0.0.1` by default. Put it behind a TLS reverse proxy/firewall before exposing the customer endpoints; keep internal endpoints private.

## Not yet verified / launch blockers

- The worker is not deployed; no customer jobs are being processed by a live worker.
- No staging end-to-end test has exercised PostgreSQL, private Blob storage, FFprobe/FFmpeg, OpenAI transcription/translation, result downloads and cleanup together.
- CI includes a PostgreSQL lease-recovery SQL test and worker unit tests, but an abrupt process kill/restart test against a running staging worker remains outstanding.
- Razorpay test-mode checkout, signed webhook delivery, duplicate/replay cases and refund scenarios still need route-level integration tests.
- Production secrets, webhook configuration, VPS setup and production deployment are not included.

Do not send customer jobs to this worker until staging end-to-end checks pass. Only server-verified paid jobs may enter the caption-processing queue. The current 24-hour job expiry in the database is an implementation default, not an approved customer-facing retention policy; confirm retention wording and behavior before launch.
