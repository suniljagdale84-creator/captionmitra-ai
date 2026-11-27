-- Track verified Razorpay payment failures and refunds.
ALTER TYPE caption_job_status ADD VALUE IF NOT EXISTS 'refunded';

ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS provider_refund_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS refunded_amount_paise INTEGER
    CHECK (refunded_amount_paise IS NULL OR refunded_amount_paise > 0),
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS caption_jobs_payment_status_idx
  ON caption_jobs (status, updated_at DESC);
