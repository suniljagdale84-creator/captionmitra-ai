-- PostgreSQL integration test for stale pre-payment media-inspection lease recovery.
-- Mirrors the worker recovery transition; transaction is rolled back.
BEGIN;

DO $$
DECLARE
  v_retry_job UUID;
  v_exhausted_job UUID;
  v_status TEXT;
  v_lock TEXT;
  v_events INTEGER;
BEGIN
  INSERT INTO caption_jobs (
    idempotency_key, source_blob_path, source_size_bytes, source_content_type,
    output_language, status
  ) VALUES (
    'inspection-lease-retry-' || gen_random_uuid()::text,
    'incoming/inspection-lease-retry-' || gen_random_uuid()::text,
    1024, 'video/mp4', 'hi', 'awaiting_payment'
  ) RETURNING id INTO v_retry_job;

  INSERT INTO caption_jobs (
    idempotency_key, source_blob_path, source_size_bytes, source_content_type,
    output_language, status
  ) VALUES (
    'inspection-lease-exhausted-' || gen_random_uuid()::text,
    'incoming/inspection-lease-exhausted-' || gen_random_uuid()::text,
    1024, 'video/mp4', 'hi', 'awaiting_payment'
  ) RETURNING id INTO v_exhausted_job;

  INSERT INTO caption_media_inspections
    (job_id, status, attempt_count, locked_at, locked_by)
  VALUES
    (v_retry_job, 'processing', 1, NOW() - INTERVAL '6 minutes', 'dead-worker'),
    (v_exhausted_job, 'processing', 3, NOW() - INTERVAL '6 minutes', 'dead-worker');

  UPDATE caption_media_inspections
     SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END,
         available_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         last_error_code = 'inspection_lease_expired',
         updated_at = NOW()
   WHERE status = 'processing'
     AND locked_at < NOW() - INTERVAL '5 minutes';

  SELECT status, locked_by INTO v_status, v_lock
    FROM caption_media_inspections WHERE job_id = v_retry_job;
  IF v_status <> 'pending' OR v_lock IS NOT NULL THEN
    RAISE EXCEPTION 'Recoverable inspection lease was not returned to pending';
  END IF;

  SELECT status INTO v_status
    FROM caption_media_inspections WHERE job_id = v_exhausted_job;
  IF v_status <> 'failed' THEN
    RAISE EXCEPTION 'Exhausted inspection lease was not marked failed';
  END IF;

  INSERT INTO caption_job_events (job_id, from_status, to_status, event_code)
  SELECT v_exhausted_job, 'awaiting_payment', 'awaiting_payment', 'media_inspection_lease_expired'
  WHERE EXISTS (
    SELECT 1 FROM caption_media_inspections
    WHERE job_id = v_exhausted_job AND status = 'failed'
  );

  SELECT COUNT(*) INTO v_events FROM caption_job_events
   WHERE job_id = v_exhausted_job AND event_code = 'media_inspection_lease_expired';
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'Expected one audit event for exhausted inspection lease';
  END IF;
END $$;

ROLLBACK;
