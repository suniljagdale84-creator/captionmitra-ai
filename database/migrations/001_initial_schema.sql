-- CaptionMitra PostgreSQL foundation.
-- Apply once to a new PostgreSQL database after review.
-- No customer media, API secrets, or raw payment payloads belong in these tables.

CREATE TYPE caption_job_status AS ENUM (
  'awaiting_upload',
  'uploaded',
  'awaiting_payment',
  'paid',
  'queued',
  'processing',
  'completed',
  'payment_failed',
  'processing_failed',
  'expired',
  'cancelled'
);

CREATE TABLE caption_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  source_blob_path TEXT UNIQUE,
  source_size_bytes BIGINT CHECK (source_size_bytes IS NULL OR source_size_bytes BETWEEN 1 AND 209715200),
  source_content_type TEXT,
  media_duration_seconds NUMERIC(12, 3) CHECK (media_duration_seconds IS NULL OR media_duration_seconds > 0),
  output_language TEXT NOT NULL,
  status caption_job_status NOT NULL DEFAULT 'awaiting_upload',
  amount_paise INTEGER CHECK (amount_paise IS NULL OR amount_paise >= 1000),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  payment_provider TEXT,
  provider_order_id TEXT UNIQUE,
  provider_payment_id TEXT UNIQUE,
  payment_verified_at TIMESTAMPTZ,
  result_blob_path TEXT UNIQUE,
  error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 0 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT caption_jobs_paid_has_verified_payment CHECK (
    status NOT IN ('paid', 'queued', 'processing', 'completed')
    OR (payment_verified_at IS NOT NULL AND amount_paise IS NOT NULL)
  ),
  CONSTRAINT caption_jobs_processing_has_source CHECK (
    status NOT IN ('queued', 'processing', 'completed')
    OR source_blob_path IS NOT NULL
  )
);

CREATE INDEX caption_jobs_queue_idx
  ON caption_jobs (available_at, created_at)
  WHERE status = 'queued';

CREATE INDEX caption_jobs_expiry_idx
  ON caption_jobs (expires_at)
  WHERE status IN ('awaiting_upload', 'uploaded', 'awaiting_payment', 'payment_failed');

CREATE INDEX caption_jobs_stale_worker_idx
  ON caption_jobs (locked_at)
  WHERE status = 'processing';

-- Store only event identifiers and a digest for webhook idempotency.
-- Never persist card data, secrets, or full raw webhook bodies here.
CREATE TABLE payment_webhook_events (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_error_code TEXT,
  PRIMARY KEY (provider, provider_event_id)
);

-- Append-only operational history; avoid storing transcript text or secrets.
CREATE TABLE caption_job_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES caption_jobs(id) ON DELETE CASCADE,
  from_status caption_job_status,
  to_status caption_job_status NOT NULL,
  event_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX caption_job_events_job_idx
  ON caption_job_events (job_id, created_at DESC);

-- Worker claim pattern (execute inside a transaction):
-- SELECT id
-- FROM caption_jobs
-- WHERE status = 'queued' AND available_at <= NOW()
-- ORDER BY available_at, created_at
-- FOR UPDATE SKIP LOCKED
-- LIMIT 1;
--
-- After locking a row, update status='processing', locked_at=NOW(),
-- locked_by=<worker instance id>, updated_at=NOW(), then COMMIT.
-- Reclaim stale processing jobs only after checking the lease timeout.
