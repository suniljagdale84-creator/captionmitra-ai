# CaptionMitra pre-VPS implementation plan

This branch prepares and validates CaptionMitra before any VPS purchase. Do not merge or deploy this branch to production until the owner approves and staging checks pass.

## Confirmed business rules

- INR 3 per minute, prorated by exact measured duration.
- Minimum charge INR 10; fractional paise rounded upward.
- Per-video payment only; no subscription, compulsory recharge, or unused wallet balance.
- Payment must be verified server-side before processing starts.
- Customer selects and uploads one whole file; multipart transfer is handled automatically by the browser SDK for files above 100 MB.
- Maximum target upload size: 200 MiB.
- Temporary source media must be deleted after terminal processing outcomes.
- VPS budget target is about INR 1,500/month; do not purchase until setup and provider checks are complete.

## Implemented on the preparation branch

- Private Vercel Blob presigned upload with Cloudflare Turnstile authorization and a 200 MiB cap.
- Browser upload progress and automatic multipart mode above 100 MiB.
- Job creation verifies private Blob metadata server-side and stores a hashed per-job customer access token.
- Pre-payment media-inspection queue downloads the private object and uses FFprobe to measure duration; browser duration is display-only.
- Server pricing formula is `max(1000, ceil(duration_seconds * 5))` paise.
- Razorpay order creation is gated on successful server-side duration inspection.
- Webhook handling validates raw-body signatures, event identifiers, payment/refund details and idempotency; paid-job queue claims require verified payment.
- Separate Node.js worker pipeline for FFmpeg extraction, bounded audio chunks, timestamped transcription, Hindi/Marathi/English/Hinglish output translation, SRT/TXT packaging and private result storage.
- Durable cleanup queue and a worker scheduler that runs immediately and every 15 minutes. Terminal source media is eligible for deletion; result objects are retained until job expiry.
- Customer status and SRT/TXT download routes proxy to the worker using per-job customer credentials.
- PostgreSQL migrations and persistence/lease tests, worker unit tests, Razorpay helper and route-level webhook tests, Next.js production build, and Playwright responsive browser checks are in CI.

## Latest automated validation

- PR #1 remains Open, Draft and unmerged; production `main` is unchanged.
- Latest branch head: `90a489938f5d2012339293b35235657a3e2d1219`.
- GitHub Actions CI run #450 passed in full, including PostgreSQL migrations and persistence tests, worker tests with a real FFmpeg/FFprobe media integration fixture, Next.js production build, Razorpay webhook route tests, and Playwright browser checks at viewport widths from 320 px to 1440 px.
- These are automated CI checks. They do not prove physical-device behavior or live Vercel Blob, OpenAI, Razorpay checkout, VPS networking, or end-to-end customer processing.

## Outstanding work before launch

1. Run real staging upload tests, including a file above 100 MiB, verify the single-file customer experience, object metadata, retries, and abandoned-upload cleanup.
2. Deploy the worker only to a controlled staging environment and test FFprobe/FFmpeg, all four output languages, OpenAI API behavior, result download, source deletion and result expiry end-to-end.
3. Exercise abrupt worker shutdown/restart and verify inspection and paid-job lease recovery against a live staging database.
4. Run Razorpay test-mode checkout and signed webhook scenarios end-to-end, including duplicates/replays, payment failure, partial refunds and full refunds. Current CI includes route-level webhook validation tests, not a complete provider checkout integration.
5. Review upload/job rate limits, abuse controls, provider cost limits, monitoring, backups and incident handling.
6. Decide customer-facing result retention and privacy policy. The current database default expiry of 24 hours is not an owner-approved customer promise.
7. Compare VPS providers and total monthly costs before purchase. No VPS purchase or deployment without explicit approval.
8. Only after staging acceptance and owner approval, plan production deployment and enable live payment credentials.

## Safety constraints

- Never commit API keys, payment secrets, database credentials, or environment files.
- Never process a job based only on a browser success message; verify payment on the server.
- Keep webhook handling idempotent.
- Limit worker concurrency and API spend.
- Do not promise 200 MiB processing until upload, download, FFmpeg, transcription, result delivery and cleanup pass end-to-end tests.
