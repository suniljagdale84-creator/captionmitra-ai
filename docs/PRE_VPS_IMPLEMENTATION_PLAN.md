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
- Webhook helpers validate signatures and payment/refund event data; verified captured payment is required before paid-job queue claims.
- Separate Node.js worker pipeline for FFmpeg extraction, bounded audio chunks, timestamped transcription, Hindi/Marathi/English/Hinglish output translation, SRT/TXT packaging and private result storage.
- Durable cleanup queue and scheduler for eligible temporary source media and expired result objects.
- Customer status and download routes proxy to the worker using per-job customer credentials.
- PostgreSQL migrations, SQL persistence/lease tests, worker unit tests, webhook helper tests and Playwright responsive viewport checks are in CI.

## Latest automated validation
- PR #1 remains Draft and unmerged; production `main` is unchanged.
- Latest known branch head after responsive test improvement: `07cff8c8f889106a7a16c82260d0dac8bf182e70`.
- GitHub Actions CI run #434 passed, including PostgreSQL migration and persistence tests, worker tests, Next.js production build and responsive Playwright checks at 320–1440 px.
- Vercel status check for that commit reported success. This does not mean the worker is deployed or that live Blob upload/processing has been tested.

## Outstanding work before launch
1. Run real staging upload tests, including a file above 100 MiB, verify single-file customer experience, object metadata and retry behavior.
2. Deploy worker only to a controlled staging environment and test FFprobe/FFmpeg, all four output languages, OpenAI API behavior, result download and cleanup end-to-end.
3. Exercise abrupt worker shutdown/restart and verify inspection and paid-job lease recovery against a live staging database.
4. Add route-level Razorpay test-mode integration tests for checkout, signed webhooks, duplicates/replays, payment failure and refunds.
5. Review upload/job rate limits, abuse controls, provider cost limits, monitoring, backup and incident handling.
6. Decide customer-facing result retention and privacy policy. The current database default expiry of 24 hours is not yet an owner-approved customer promise.
7. Compare VPS providers and total monthly costs before purchase. No VPS purchase or deployment without explicit approval.
8. Only after staging acceptance and owner approval, plan production deployment and enable live payment credentials.

## Safety constraints
- Never commit API keys, payment secrets, database credentials, or environment files.
- Never process a job based only on a browser success message; verify payment on the server.
- Keep webhook handling idempotent.
- Limit worker concurrency and API spend.
- Do not promise 200 MiB processing until upload, download, FFmpeg, transcription, result delivery and cleanup pass end-to-end tests.
