# Verified upload-to-job flow

## Endpoint
The Next.js application exposes POST /api/jobs. It is called only after the browser upload has completed.

Required JSON fields:
- pathname: returned by the private Blob upload SDK
- language: Hindi, Marathi, English, or Hinglish
- idempotencyKey: browser-generated UUID for retry safety
- turnstileToken: a fresh Cloudflare Turnstile token (the upload challenge token has already been consumed)

## Server-side checks
1. Validate request shape and supported language.
2. Verify the fresh Turnstile challenge.
3. Read the private Blob object's metadata with the server-side Blob token.
4. Enforce the 200 MiB limit and MIME allowlist using storage metadata, not browser claims.
5. Generate a cryptographically random 256-bit customer download credential on the server.
6. Store only the SHA-256 digest in PostgreSQL.
7. Create the job in awaiting_payment status and append an operational event.
8. Return the raw customer credential once with Cache-Control: no-store.

On an idempotent retry for the same upload path and language, a new credential is issued and the previous one is invalidated. The browser holds the credential in page memory only; it is not written to localStorage.

## Required environment and database setup
- DATABASE_URL must point to the same PostgreSQL database used by the worker.
- BLOB_READ_WRITE_TOKEN must have access to the same private Blob store used by the upload route.
- TURNSTILE_SECRET_KEY and SITE_KEY must be configured.
- Apply database migrations 001 and 002 before enabling this route.

## Important launch boundary
A created job is awaiting_payment. No payment is verified and no processing is started by this endpoint. Do not mark jobs paid from the browser. Payment provider webhook verification and a separate durable queue trigger must be implemented before any paid processing is enabled.

The endpoint has not yet been built and integration-tested in a live Vercel/PostgreSQL/Blob environment. Do not treat this setup branch as production-ready. A periodic cleanup task for uploaded blobs that never become jobs is also still required.
