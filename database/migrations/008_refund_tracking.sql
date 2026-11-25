-- Track provider refunds separately from the caption job lifecycle.
ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none', 'refund_pending', 'refunded', 'failed')),
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
