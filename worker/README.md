# CaptionMitra Worker (pre-deployment)

Separate Node.js 20+ service intended to run on the future Ubuntu VPS. The server code starts both the pre-payment media-inspection loop and the paid-job processing loop when the service starts. This worker has **not** been deployed or connected to a live customer environment.

## Included

- PostgreSQL connection pool with bounded connections and timeouts.
- Pre-payment inspection polling for uploaded jobs in `awaiting_payment`: private Blob download, FFprobe duration check, exact-duration price calculation, and temporary-directory cleanup.
- Paid-job polling for `queued` jobs. The queue claim SQL requires both `payment_verified_at` and `provider_payment_id`, so an unpaid job is not eligible.
- PostgreSQL queue claims using transactions and `FOR UPDATE SKIP LOCKED`.
- Worker-owned leases, processing heartbeats, stale paid-job lease recovery, retry backoff and bounded retry count.
- Caption processing pipeline: private Blob download, FFmpeg audio extraction, eight-minute audio chunks (each checked against a 20 MB ceiling), timestamped transcription, optional translation, SRT/TXT generation and private result upload.
- Temporary media directory removal in `finally` blocks.
- Scheduled Blob cleanup.
- Loopback-only HTTP health/status and customer status/download endpoints. Internal worker status and manual cleanup endpoints require the shared bearer secret.
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

## HTTP API

- `GET /health`: checks PostgreSQL connectivity.
- `GET /internal/worker/status`: bearer-secret protected queue and cleanup status.
- `POST /internal/worker/cleanup/run`: bearer-secret protected manual cleanup trigger.
- `GET /api/customer/jobs/:id`: customer job status using the customer access token header.
- `GET /api/customer/jobs/:id/download?format=srt|txt`: private result download using the customer access token header.

The service binds to `127.0.0.1` by default. Put it behind a TLS reverse proxy/firewall before exposing the customer endpoints; keep internal endpoints private.

## Not yet verified / launch blockers

- The worker is not deployed; no customer jobs are being processed by a live worker.
- No staging end-to-end test has yet exercised PostgreSQL, private Blob storage, FFprobe/FFmpeg, OpenAI transcription/translation, result downloads and cleanup together.
- The media-inspection loop has bounded retry attempts, but inspection-job lease recovery after an abrupt worker crash still needs review/implementation.
- Razorpay test-mode checkout, signed webhook delivery, duplicate/replay cases and refund scenarios still need route-level integration tests.
- Production secrets, webhook configuration, VPS setup and production deployment are not included.

Do not send customer jobs to this worker until staging end-to-end checks pass. Only server-verified paid jobs may enter the caption-processing queue.
