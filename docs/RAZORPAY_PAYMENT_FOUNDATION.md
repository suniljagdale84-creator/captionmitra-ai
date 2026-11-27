# Razorpay payment foundation (not enabled)

This branch contains a server-side payment foundation only. It is not enabled for customers and must not be deployed as a live payment flow before staging tests and final approval.

## Endpoints
- POST /api/payments/create-order
- POST /api/payments/razorpay-webhook

## Order creation safeguards
- Requires server-side Razorpay Key ID and Key Secret.
- Requires the per-job customer access credential.
- Requires a worker-measured positive media duration; browser duration and client price are never accepted.
- Locks the job row while preparing/reusing its Razorpay order to avoid concurrent duplicate orders.
- Uses the owner-confirmed exact-duration prorated price of INR 3/minute, with a minimum charge of INR 10.
- Formula: amount in paise = max(1000, ceil(duration_seconds × 5)). This prorates by actual measured seconds and rounds any fraction of a paise upward.
- Example: 80 seconds costs INR 10 because the minimum applies; 240 seconds costs INR 12; 90 seconds costs INR 10 because the minimum applies.
- The server stores the expected amount and Razorpay order ID. The browser cannot set or change either.

## Webhook safeguards
- Requires RAZORPAY_WEBHOOK_SECRET.
- Validates HMAC-SHA256 against the exact raw request body before parsing.
- Uses Razorpay's x-razorpay-event-id for idempotency.
- Accepts only payment.captured, matching an existing order ID, exact stored amount and INR currency.
- Marks a valid awaiting_payment job as queued in the same database transaction and appends an event.
- Amount/order mismatches are recorded for manual review; they do not queue work.

## Required environment
- DATABASE_URL
- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET
- Worker and Blob secrets are configured separately; never expose secrets in client code.

## Not complete
- Razorpay Checkout UI and customer payment-status page.
- Worker queue consumer, FFmpeg duration probe, and job processing.
- Refund/reconciliation tooling and payment.failed UX.
- End-to-end test mode validation using a Razorpay test account.
- Security review and launch approval.

Do not configure live Razorpay credentials or merge this branch until all listed checks are complete.
