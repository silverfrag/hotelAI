-- Stable admin booking pagination and dashboard sales aggregation.
CREATE INDEX IF NOT EXISTS idx_bookings_created_at_booking_id
  ON bookings (created_at DESC, booking_id DESC);

-- Supports status-filtered admin booking pages without sacrificing stable order.
CREATE INDEX IF NOT EXISTS idx_bookings_status_created_at_booking_id
  ON bookings (status, created_at DESC, booking_id DESC);

-- Supports the atomic transition from Confirmed to Completed by checkout date.
CREATE INDEX IF NOT EXISTS idx_bookings_confirmed_checkout_date
  ON bookings (check_out_date, booking_id)
  WHERE status = 'Confirmed';
