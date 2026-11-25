# Retention cleanup

The worker retention helper selects expired jobs in small batches with PostgreSQL row locks and SKIP LOCKED so multiple cleanup workers do not claim the same row.

Only jobs past expires_at and not queued or processing are eligible. Source and result blobs are deleted using private Blob access. A job is marked expired and its paths cleared only after all known blobs have been deleted successfully.

If any Blob deletion fails, the database record is retained for a later retry. This preserves the path needed to retry deletion.

This helper is not scheduled or enabled by default. Before launch, add a protected scheduler, operational alerting, and a periodic sweep for abandoned upload objects that never received a job record. Confirm retention duration and customer-facing policy.

Customer download remains blocked until authenticated ownership or a verified per-job access credential is implemented.
