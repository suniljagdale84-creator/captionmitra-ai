-- Separate pre-payment media inspection queue.
-- Inspection measures duration before the customer is allowed to pay.
CREATE TABLE IF NOT EXISTS caption_media_inspections (
  job_id UUID PRIMARY KEY REFERENCES caption_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS caption_media_inspections_ready_idx
  ON caption_media_inspections (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS caption_media_inspections_stale_idx
  ON caption_media_inspections (locked_at)
  WHERE status = 'processing';
