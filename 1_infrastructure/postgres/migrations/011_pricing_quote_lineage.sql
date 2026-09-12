-- AI pricing lineage and price-guarantee contract.
-- Quotes are immutable observations. Accepting a quote only attaches the
-- resulting booking and customer; the feature/price snapshot is never updated.

ALTER TABLE daily_pricing_logs
  ADD COLUMN IF NOT EXISTS ai_model_version VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ai_training_run_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ai_feature_contract_version VARCHAR(50);

UPDATE daily_pricing_logs
SET ai_model_version = COALESCE(ai_model_version, 'legacy-unversioned'),
    ai_training_run_id = COALESCE(ai_training_run_id, 'legacy-unknown'),
    ai_feature_contract_version = COALESCE(
      ai_feature_contract_version,
      'legacy-unknown'
    )
WHERE pricing_source = 'ai'
  AND (
    ai_model_version IS NULL
    OR ai_training_run_id IS NULL
    OR ai_feature_contract_version IS NULL
  );

ALTER TABLE daily_pricing_logs
  DROP CONSTRAINT IF EXISTS daily_pricing_logs_ai_lineage_check;
ALTER TABLE daily_pricing_logs
  ADD CONSTRAINT daily_pricing_logs_ai_lineage_check CHECK (
    pricing_source = 'base'
    OR (
      ai_model_version IS NOT NULL
      AND BTRIM(ai_model_version) <> ''
      AND ai_training_run_id IS NOT NULL
      AND BTRIM(ai_training_run_id) <> ''
      AND ai_feature_contract_version IS NOT NULL
      AND BTRIM(ai_feature_contract_version) <> ''
    )
  );

CREATE INDEX IF NOT EXISTS idx_daily_pricing_logs_model_version
  ON daily_pricing_logs (ai_model_version, updated_at DESC)
  WHERE pricing_source = 'ai';

CREATE TABLE IF NOT EXISTS pricing_quotes (
  quote_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID,
  booking_id UUID UNIQUE,
  room_type_id INT NOT NULL,
  room_type_name_snapshot VARCHAR(50) NOT NULL,
  capacity_snapshot INT NOT NULL,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  guest_count INT NOT NULL DEFAULT 1,
  total_of_special_requests INT NOT NULL,
  lead_time INT NOT NULL,
  is_weekend BOOLEAN NOT NULL,
  rooms_available INT NOT NULL,
  base_price NUMERIC(10, 2) NOT NULL,
  ai_multiplier NUMERIC(5, 3) NOT NULL,
  nightly_price NUMERIC(10, 2) NOT NULL,
  total_price NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'VND',
  pricing_source VARCHAR(20) NOT NULL,
  settings_version INT NOT NULL,
  ai_model_version VARCHAR(100),
  ai_training_run_id VARCHAR(100),
  ai_feature_contract_version VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  CONSTRAINT pricing_quotes_customer_fk
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
  CONSTRAINT pricing_quotes_booking_fk
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE RESTRICT,
  CONSTRAINT pricing_quotes_room_type_fk
    FOREIGN KEY (room_type_id) REFERENCES room_types(type_id) ON DELETE RESTRICT,
  CONSTRAINT pricing_quotes_dates_check CHECK (check_out_date > check_in_date),
  CONSTRAINT pricing_quotes_guest_count_check CHECK (guest_count > 0),
  CONSTRAINT pricing_quotes_capacity_check CHECK (capacity_snapshot > 0),
  CONSTRAINT pricing_quotes_guest_capacity_check CHECK (guest_count <= capacity_snapshot),
  CONSTRAINT pricing_quotes_special_requests_check
    CHECK (total_of_special_requests BETWEEN 0 AND 5),
  CONSTRAINT pricing_quotes_lead_time_check CHECK (lead_time >= 0),
  CONSTRAINT pricing_quotes_availability_check CHECK (rooms_available >= 0),
  CONSTRAINT pricing_quotes_base_price_check CHECK (base_price > 0),
  CONSTRAINT pricing_quotes_multiplier_check CHECK (ai_multiplier BETWEEN 0.5 AND 3),
  CONSTRAINT pricing_quotes_nightly_price_check CHECK (nightly_price > 0),
  CONSTRAINT pricing_quotes_total_price_check CHECK (total_price > 0),
  CONSTRAINT pricing_quotes_currency_check CHECK (currency = 'VND'),
  CONSTRAINT pricing_quotes_source_check CHECK (pricing_source IN ('ai', 'base')),
  CONSTRAINT pricing_quotes_settings_version_check CHECK (settings_version >= 1),
  CONSTRAINT pricing_quotes_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT pricing_quotes_acceptance_check CHECK (
    (booking_id IS NULL AND accepted_at IS NULL)
    OR (booking_id IS NOT NULL AND accepted_at IS NOT NULL)
  ),
  CONSTRAINT pricing_quotes_ai_lineage_check CHECK (
    pricing_source = 'base'
    OR (
      ai_model_version IS NOT NULL
      AND BTRIM(ai_model_version) <> ''
      AND ai_training_run_id IS NOT NULL
      AND BTRIM(ai_training_run_id) <> ''
      AND ai_feature_contract_version IS NOT NULL
      AND BTRIM(ai_feature_contract_version) <> ''
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_pricing_quotes_open_expiry
  ON pricing_quotes (expires_at, quote_id)
  WHERE booking_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_pricing_quotes_model_created
  ON pricing_quotes (ai_model_version, created_at DESC)
  WHERE pricing_source = 'ai';

CREATE INDEX IF NOT EXISTS idx_pricing_quotes_room_dates
  ON pricing_quotes (room_type_id, check_in_date, check_out_date, created_at DESC);
