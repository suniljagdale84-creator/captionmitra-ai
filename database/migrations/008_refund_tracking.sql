-- Track provider refunds separately from the caption job lifecycle.
ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none', 'refund_pending', 'partially_refunded', 'refunded', 'failed')),
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_paise >= 0);
