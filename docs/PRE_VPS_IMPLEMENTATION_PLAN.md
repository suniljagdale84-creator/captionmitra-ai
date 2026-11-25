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
- The direct-upload route is not yet wired to the browser UI or a processing job.
- No payment, durable job queue, or automatic source-file cleanup workflow is present in the inspected application files.

## Implementation sequence
1. Wire browser upload to the existing presigned upload endpoint; validate file size/type and show progress/errors.
2. Design a private temporary-object lifecycle and authenticated processing handoff. Do not expose private media URLs or trust client-supplied duration/pricing.
3. Build a separate worker service suitable for Ubuntu VPS with FFmpeg, bounded concurrency, job status, retries, and guaranteed cleanup in a finally path.
4. Add transcription/translation adapters with configurable provider/model and server-side cost/size/time limits.
5. Connect results to the existing editable subtitle UI and SRT/TXT exports.
6. Add server-side price calculation (ceil duration to billable minutes, minimum INR 10) and payment gateway order/webhook verification. Confirm rounding/refund policy before production.
7. Add abuse controls, privacy/retention policy, logs without media contents, and automated tests.
8. Run end-to-end tests on a staging environment before VPS purchase.
9. Only after acceptance, purchase the monthly VPS and deploy.

## Safety constraints
- Never commit API keys, payment secrets, or environment files.
- Do not process a paid job based only on a browser success message; verify payment on the server.
- Make webhook handling idempotent.
- Limit worker concurrency and API spend.
- Do not promise 200 MB processing until upload, download, FFmpeg, transcription, and cleanup have passed end-to-end tests.
