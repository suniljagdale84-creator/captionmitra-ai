-- Customer-visible progress metadata; never stores transcript or media content.
ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS progress_percent SMALLINT NOT NULL DEFAULT 0
    CHECK (progress_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS progress_stage TEXT NOT NULL DEFAULT 'queued'
    CHECK (progress_stage IN ('queued','downloading','extracting_audio','transcribing','translating','saving_result','completed','failed')),
  ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS caption_jobs_progress_idx
  ON caption_jobs (updated_at DESC)
  WHERE status IN ('queued','processing');
