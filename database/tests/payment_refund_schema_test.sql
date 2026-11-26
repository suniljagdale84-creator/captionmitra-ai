-- PostgreSQL integration smoke test for refund persistence and event idempotency.
-- Run after all migrations; transaction is rolled back so CI data is not retained.
BEGIN;

DO $$
DECLARE
  v_job UUID;
  v_total BIGINT;
  v_event_count INTEGER;
BEGIN
  INSERT INTO caption_jobs (
    idempotency_key, source_blob_path, source_size_bytes, source_content_type,
    output_language, status, amount_paise, payment_provider, provider_order_id,
    provider_payment_id, payment_verified_at
  ) VALUES (
    'refund-schema-test-' || gen_random_uuid()::text,
    'incoming/refund-schema-test-' || gen_random_uuid()::text,
    1024, 'video/mp4', 'hi', 'queued', 5000, 'razorpay',
    'order_refund_schema_test_' || gen_random_uuid()::text,
    'pay_refund_schema_test_' || gen_random_uuid()::text, NOW()
  ) RETURNING id INTO v_job;

  INSERT INTO caption_payment_refunds (
    job_id, provider_refund_id, provider_payment_id, amount_paise, currency, status
  )
  SELECT v_job, 'rfnd_schema_test_1', j.provider_payment_id, 1200, 'INR', 'processed'
  FROM caption_jobs j WHERE j.id = v_job;

  INSERT INTO caption_payment_refunds (
    job_id, provider_refund_id, provider_payment_id, amount_paise, currency, status
  )
  SELECT v_job, 'rfnd_schema_test_2', j.provider_payment_id, 800, 'INR', 'processed'
  FROM caption_jobs j WHERE j.id = v_job;

  SELECT COALESCE(SUM(amount_paise), 0)
    INTO v_total
    FROM caption_payment_refunds
   WHERE job_id = v_job AND status = 'processed';

  IF v_total <> 2000 THEN
    RAISE EXCEPTION 'Expected two partial refunds to total 2000 paise, got %', v_total;
  END IF;

  -- Refund IDs must be globally unique per provider, even across jobs.
  BEGIN
    INSERT INTO caption_payment_refunds (
      job_id, provider_refund_id, provider_payment_id, amount_paise, currency, status
    )
    SELECT id, 'rfnd_schema_test_1', provider_payment_id, 100, 'INR', 'processed'
      FROM caption_jobs WHERE id = v_job;
    RAISE EXCEPTION 'Duplicate provider refund ID was unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- A refund may not be zero or negative.
  BEGIN
    INSERT INTO caption_payment_refunds (
      job_id, provider_refund_id, provider_payment_id, amount_paise, currency, status
    )
    SELECT id, 'rfnd_schema_test_invalid_amount', provider_payment_id, 0, 'INR', 'processed'
      FROM caption_jobs WHERE id = v_job;
    RAISE EXCEPTION 'Zero-value refund was unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Reusing an event ID with a different digest must be detectable by lookup.
  INSERT INTO payment_webhook_events (provider, provider_event_id, payload_sha256)
  VALUES ('razorpay', 'evt_refund_schema_conflict', repeat('b', 64));
  IF NOT EXISTS (
    SELECT 1 FROM payment_webhook_events
     WHERE provider = 'razorpay'
       AND provider_event_id = 'evt_refund_schema_conflict'
       AND payload_sha256 <> repeat('c', 64)
  ) THEN
    RAISE EXCEPTION 'Conflicting webhook event digest was not distinguishable';
  END IF;

  INSERT INTO payment_webhook_events (provider, provider_event_id, payload_sha256)
  VALUES ('razorpay', 'evt_refund_schema_test', repeat('a', 64));

  INSERT INTO payment_webhook_events (provider, provider_event_id, payload_sha256)
  VALUES ('razorpay', 'evt_refund_schema_test', repeat('a', 64))
  ON CONFLICT DO NOTHING;

  SELECT COUNT(*) INTO v_event_count
    FROM payment_webhook_events
   WHERE provider = 'razorpay' AND provider_event_id = 'evt_refund_schema_test';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'Webhook event idempotency constraint did not prevent duplicate event';
  END IF;
END $$;

ROLLBACK;
