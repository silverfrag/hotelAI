ALTER TABLE daily_pricing_logs DROP CONSTRAINT IF EXISTS unique_daily_price;
ALTER TABLE daily_pricing_logs ADD COLUMN IF NOT EXISTS booking_id UUID;
ALTER TABLE daily_pricing_logs ADD COLUMN IF NOT EXISTS lead_time INT;
ALTER TABLE daily_pricing_logs ADD COLUMN IF NOT EXISTS is_weekend BOOLEAN;
ALTER TABLE daily_pricing_logs ADD COLUMN IF NOT EXISTS total_of_special_requests INT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_pricing_logs_booking_fk' AND conrelid = 'daily_pricing_logs'::regclass) THEN
    ALTER TABLE daily_pricing_logs ADD CONSTRAINT daily_pricing_logs_booking_fk
      FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_pricing_logs_booking_unique' AND conrelid = 'daily_pricing_logs'::regclass) THEN
    ALTER TABLE daily_pricing_logs ADD CONSTRAINT daily_pricing_logs_booking_unique UNIQUE (booking_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_pricing_logs_lead_time_check' AND conrelid = 'daily_pricing_logs'::regclass) THEN
    ALTER TABLE daily_pricing_logs ADD CONSTRAINT daily_pricing_logs_lead_time_check CHECK (lead_time IS NULL OR lead_time >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_pricing_logs_multiplier_range_check' AND conrelid = 'daily_pricing_logs'::regclass) THEN
    ALTER TABLE daily_pricing_logs ADD CONSTRAINT daily_pricing_logs_multiplier_range_check CHECK (ai_multiplier BETWEEN 0.5 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positive_final_price' AND conrelid = 'daily_pricing_logs'::regclass) THEN
    ALTER TABLE daily_pricing_logs ADD CONSTRAINT positive_final_price CHECK (final_price >= 0);
  END IF;
END $$;

ALTER TABLE daily_pricing_logs DROP CONSTRAINT IF EXISTS daily_pricing_logs_special_requests_check;
ALTER TABLE daily_pricing_logs ADD CONSTRAINT daily_pricing_logs_special_requests_check
  CHECK (total_of_special_requests IS NULL OR total_of_special_requests BETWEEN 0 AND 5);
