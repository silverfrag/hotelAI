-- Booking request integrity:
-- 1. Persist guest count with a safe default for historical bookings.
-- 2. Persist idempotency claims separately from the booking aggregate so the
--    public booking response never exposes request hashes or idempotency keys.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS guest_count INT;

UPDATE bookings
SET guest_count = 1
WHERE guest_count IS NULL;

ALTER TABLE bookings
  ALTER COLUMN guest_count SET DEFAULT 1,
  ALTER COLUMN guest_count SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'bookings'::regclass
      AND conname = 'bookings_guest_count_check'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_guest_count_check CHECK (guest_count > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_create_requests (
  customer_id UUID NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  booking_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, idempotency_key),
  CONSTRAINT booking_create_requests_customer_fk
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
  CONSTRAINT booking_create_requests_booking_fk
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
  CONSTRAINT booking_create_requests_key_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  CONSTRAINT booking_create_requests_hash_check
    CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
