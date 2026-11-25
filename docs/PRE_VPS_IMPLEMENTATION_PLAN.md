# CaptionMitra pre-VPS implementation plan

This branch is for preparing and validating CaptionMitra before purchasing a VPS.
Do not deploy this branch to production until the relevant checks pass.

## Business rules
- Customer price: INR 3 per video minute.
- Minimum charge: INR 10.
- No subscription, compulsory recharge, or stored unused wallet balance.
- Payment must be verified server-side before processing starts.
- Temporary source media must be deleted after success or failure.
- Initial VPS budget target: about INR 1,500/month; do not purchase until setup and provider checks are complete.

## Current repository audit (2026-11-25)
- Next.js 14.2.21 app with an existing subtitle editor and SRT/TXT downloads.
- `src/app/api/captions/route.ts` still accepts multipart uploads directly and rejects files above 25 MB.
- `src/app/page.tsx` still posts the selected file directly to `/api/captions`.
- `src/app/api/upload/route.ts` already issues Vercel Blob presigned upload authorization for up to 200 MB and verifies Cloudflare Turnstile.
- The browser UI now uses the Vercel Blob presigned client-upload flow and enables multipart uploads for files larger than 100 MB. Customers still select and upload one complete file.
- The upload UI stores the returned private Blob pathname only in its local success state; it does not start processing yet.
- No payment, durable job queue, or automatic source-file cleanup workflow is present in the inspected application files.

## Implementation sequence
1. ~~Wire browser upload to the existing presigned upload endpoint; validate file size/type and show progress/errors.~~ Implemented on the preparation branch; GitHub Actions build passed for the latest upload commit. End-to-end Blob upload still needs a real staging test.
2. Design a private temporary-object lifecycle and authenticated processing handoff. Do not expose private media URLs or trust client-supplied duration/pricing. See `docs/WORKER_ARCHITECTURE.md`.
3. Build a separate worker service suitable for Ubuntu VPS with FFmpeg, bounded concurrency, job status, retries, and guaranteed cleanup in a finally path.
4. Add transcription/translation adapters with configurable provider/model and server-side cost/size/time limits.
5. Connect results to the existing editable subtitle UI and SRT/TXT exports.
6. Add server-side price calculation at INR 3/minute prorated by exact measured duration, rounded up to the nearest paise, with a minimum INR 10, plus payment gateway order/webhook verification. Confirm refund policy before production.
7. Add abuse controls, privacy/retention policy, logs without media contents, and automated tests.
8. Run end-to-end tests on a staging environment before VPS purchase.
9. Only after acceptance, purchase the monthly VPS and deploy.

## Validation status (2026-11-25)
- Latest upload branch commit: `d291ecc1ec56564b7b9a83776233eb345d1c228c`.
- GitHub Actions build: passed (`CaptionMitra CI`).
- Draft PR #1 remains open and unmerged. Production `main` is unchanged.
- No real 200 MB upload, private Blob retrieval, worker processing, or deletion test has been completed. Do not describe upload or processing as production-ready.

## Safety constraints
- Never commit API keys, payment secrets, or environment files.
- Do not process a paid job based only on a browser success message; verify payment on the server.
- Make webhook handling idempotent.
- Limit worker concurrency and API spend.
- Do not promise 200 MB processing until upload, download, FFmpeg, transcription, and cleanup have passed end-to-end tests.
