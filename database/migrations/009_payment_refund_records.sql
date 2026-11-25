-- Persist each Razorpay refund independently so repeated partial refunds
-- can be reconciled safely and refund IDs remain idempotent.
CREATE TABLE caption_payment_refunds (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES caption_jobs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay' CHECK (provider = 'razorpay'),
  provider_refund_id TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL CHECK (currency = 'INR'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_refund_id)
);

CREATE INDEX caption_payment_refunds_job_idx
  ON caption_payment_refunds (job_id, status);
