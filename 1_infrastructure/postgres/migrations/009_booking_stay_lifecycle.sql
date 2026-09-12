-- Explicit hotel stay lifecycle: Confirmed -> CheckedIn -> Completed.
-- Confirmed -> Canceled remains the only cancellation transition.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_in_by UUID,
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_out_by UUID;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS occupancy_booking_id UUID;

DO $$
DECLARE
  status_constraint TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO status_constraint
  FROM pg_constraint
  WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_status_check';

  IF status_constraint IS NULL OR position('CheckedIn' IN status_constraint) = 0 THEN
    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_status_check
      CHECK (status IN ('Confirmed', 'CheckedIn', 'Canceled', 'Completed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_checked_in_by_fk'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_checked_in_by_fk
      FOREIGN KEY (checked_in_by) REFERENCES customers(customer_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_checked_out_by_fk'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_checked_out_by_fk
      FOREIGN KEY (checked_out_by) REFERENCES customers(customer_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_stay_audit_check'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_stay_audit_check CHECK (
        (status <> 'CheckedIn' OR (checked_in_at IS NOT NULL AND checked_in_by IS NOT NULL))
        AND (checked_out_at IS NULL OR checked_in_at IS NOT NULL)
        AND ((checked_out_at IS NULL AND checked_out_by IS NULL)
          OR (checked_out_at IS NOT NULL AND checked_out_by IS NOT NULL))
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass AND conname = 'rooms_occupancy_booking_fk'
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_occupancy_booking_fk
      FOREIGN KEY (occupancy_booking_id) REFERENCES bookings(booking_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass AND conname = 'rooms_occupancy_state_check'
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_occupancy_state_check
      CHECK (occupancy_booking_id IS NULL OR current_status = 'Occupied');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rooms_occupancy_booking_id
  ON rooms (occupancy_booking_id)
  WHERE occupancy_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_active_room_dates
  ON bookings (check_in_date, check_out_date, booking_id)
  WHERE status IN ('Confirmed', 'CheckedIn');

CREATE INDEX IF NOT EXISTS idx_bookings_checked_in_checkout_date
  ON bookings (check_out_date, booking_id)
  WHERE status = 'CheckedIn';
