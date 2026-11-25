# CaptionMitra worker and private-media architecture

Status: design proposal for pre-VPS implementation. This document does not deploy services or create paid accounts.

## Customer upload experience
- The customer selects one complete video/audio file in the browser.
- The browser uploads directly to Vercel Blob using the presigned client-upload flow.
- Files larger than 100 MB use the SDK multipart option; the customer never cuts the file into parts.
- Blob storage remains private. The browser must not send a public media URL to the worker or display a private download URL as a shareable link.
- The current UI is upload-only. A successful upload is not yet a paid processing job.

## Proposed processing flow
1. Browser requests upload authorization. The web API checks Turnstile and issues a short-lived, path-constrained upload authorization.
2. Browser uploads the single selected file to private Blob storage. Large uploads use SDK-managed multipart transfer.
3. A verified Blob upload-completed callback records the completed object reference. Never trust a browser-only success message as proof that a Blob exists.
4. Customer requests a quote. The server obtains media metadata/duration from a trusted probe, enforces size/duration limits, and calculates the price. Client-supplied duration and price are informational only and must never be trusted.
5. The server creates a payment order with an idempotency key. The exact payment provider, rounding rule for partial minutes, and refund policy must be confirmed before production.
6. A payment webhook is signature-verified and idempotently marks the order paid. Processing cannot start from a browser redirect or client-side payment-success flag.
7. The web API submits a job to the authenticated worker API. The job contains an opaque private Blob pathname, requested output language, order ID, and server-computed limits—not a public URL or client-provided price.
8. The worker downloads the private Blob using server-side credentials, probes it with FFmpeg/ffprobe, extracts audio, splits audio into provider-compatible chunks, transcribes, translates, and stores subtitle output.
9. The worker reports job status/result through an authenticated callback or status API. The web app presents editable captions and SRT/TXT downloads.
10. The worker deletes local source/audio temporary files in a finally path. A separate scheduled cleanup removes abandoned Blob uploads and expired job artifacts, including after crashes.

## Proposed worker deployment shape
- Keep the customer-facing Next.js app on Vercel for now.
- Run a separate Node.js worker/API and FFmpeg on the eventual Ubuntu VPS.
- Use a durable database-backed job queue; do not rely on in-memory arrays or a single long HTTP request.
- PostgreSQL is the preferred queue/job-state store for reliability and future concurrency. The final hosting arrangement and connection security still need testing.
- Worker API must require a high-entropy shared secret or signed short-lived service tokens, use TLS, validate every job field, and rate-limit requests.
- Worker concurrency, maximum duration, temporary disk usage, retry count, and AI spend must be bounded.
- Do not expose the VPS worker port publicly without an authenticated reverse proxy/firewall policy.

## Required job states
`awaiting_upload` → `uploaded` → `awaiting_payment` → `paid` → `queued` → `processing` → `completed`

Failure states: `payment_failed`, `processing_failed`, `expired`, `cancelled`.

Transitions must be server-controlled. Payment and job transitions must be idempotent so duplicate webhooks or retries cannot create duplicate charges or duplicate processing.

## Data to persist (minimum)
- Order/job ID; opaque Blob pathname; upload size/type; server-probed duration; output language.
- Server-calculated amount/currency; payment provider order/payment IDs; verified payment timestamp.
- Job state; retry count; created/updated/expiry timestamps; result storage reference.
- Do not store API secrets, raw payment credentials, or media contents in logs.

## Privacy and cleanup requirements
- Private Blob access only; worker credentials remain server-side.
- Never log media bytes, transcripts, or secret tokens.
- Delete temporary source media after processing success or failure according to a clearly stated retention policy.
- Add a periodic TTL cleanup for incomplete uploads and stale jobs; a finally block alone cannot handle VPS crashes.
- Define customer-visible privacy/retention terms before accepting real customer videos.

## Acceptance tests before purchase/deployment
- Upload one small file and one 100–200 MB file through the browser; verify multipart retry/progress and a single final Blob object.
- Confirm private object access is denied without server credentials and succeeds only from the worker.
- Confirm forged upload callbacks, forged payment webhooks, expired tokens, oversized files, invalid MIME types, and duplicate events are rejected safely.
- Process a sample video end-to-end; compare duration, transcription, translated segments, and SRT timing.
- Simulate worker crash/retry and verify no duplicate payment or duplicate final job.
- Verify local temporary files and source Blob cleanup on success, failure, and abandoned jobs.
- Load-test bounded concurrency and monitor API spend, memory, CPU, disk, and job latency.

## Decisions intentionally not made yet
- Payment gateway and payment/refund policy.
- Partial-minute billing rule (rounding up/down/seconds-based).
- Database hosting and final worker-to-web authentication mechanism.
- Final privacy retention period and user deletion workflow.
- Production VPS purchase and deployment.

No production deployment or paid infrastructure purchase is authorized by this design.
