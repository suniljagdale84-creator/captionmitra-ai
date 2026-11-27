-- Durable, retryable cleanup queue for private customer media.
CREATE TABLE IF NOT EXISTS caption_blob_cleanup_tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES caption_jobs(id) ON DELETE CASCADE,
  blob_kind TEXT NOT NULL CHECK (blob_kind IN ('source', 'result')),
  blob_path TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, blob_kind, blob_path)
);

CREATE INDEX IF NOT EXISTS caption_blob_cleanup_ready_idx
  ON caption_blob_cleanup_tasks (available_at, created_at)
  WHERE locked_at IS NULL;

ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS source_deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS result_deleted_at TIMESTAMPTZ;
