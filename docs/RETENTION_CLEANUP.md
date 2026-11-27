# Retention cleanup

The worker starts a durable Blob cleanup scheduler at process startup. It runs immediately and then every 15 minutes. The scheduler is currently part of the worker process; production monitoring and alerting still need to be configured.

## Source media

The cleanup worker enqueues source blobs for jobs in terminal states: completed, payment_failed, processing_failed, refunded, expired, or cancelled. This means the private source file is eligible for deletion after processing reaches a terminal outcome, rather than waiting for the result-retention period.

## Caption results

Result blobs are enqueued only after the job's `expires_at` time has passed. The database currently defaults this field to 24 hours after job creation. That is an implementation default, not an owner-approved customer-facing retention promise. Confirm the intended result-retention policy before launch.

## Reliability

Cleanup tasks are persisted in PostgreSQL and claimed in bounded batches using row locks and `SKIP LOCKED`. Blob deletion failures leave the task available for retry; the current retry delay is five minutes. Blob paths are cleared from the job only after successful deletion.

## Remaining launch work

- Configure monitoring and alerting for repeated cleanup failures and backlog growth.
- Add a periodic sweep for abandoned upload objects that never received a job record.
- Confirm and publish the customer-facing result-retention and privacy policy.
- Verify source deletion, result expiry, and retry behavior in a live staging environment.

Customer status and download routes are implemented using a random per-job access token. The token hash is stored in PostgreSQL; the raw token is returned once when the job is created. Staging verification is still required before launch.
