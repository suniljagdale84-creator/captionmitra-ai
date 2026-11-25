-- Customer download credentials are random per-job bearer secrets.
-- Only a SHA-256 digest is stored; the raw credential is shown once at job creation.
ALTER TABLE caption_jobs
  ADD COLUMN customer_access_token_hash CHAR(64),
  ADD COLUMN customer_access_token_created_at TIMESTAMPTZ,
  ADD COLUMN customer_last_downloaded_at TIMESTAMPTZ,
  ADD COLUMN customer_download_count INTEGER NOT NULL DEFAULT 0
    CHECK (customer_download_count >= 0);

CREATE UNIQUE INDEX caption_jobs_customer_access_token_hash_idx
  ON caption_jobs (customer_access_token_hash)
  WHERE customer_access_token_hash IS NOT NULL;

COMMENT ON COLUMN caption_jobs.customer_access_token_hash IS
  'SHA-256 digest of a cryptographically random per-job customer download credential; never store the raw token.';
