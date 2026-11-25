-- Track the latest checkout attempt independently from the job lifecycle.
-- A failed attempt must remain payable so the customer can retry.
ALTER TABLE caption_jobs
  ADD COLUMN IF NOT EXISTS payment_attempt_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_attempt_status IN ('pending', 'failed'));
