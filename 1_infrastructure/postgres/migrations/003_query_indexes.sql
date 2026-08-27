CREATE INDEX IF NOT EXISTS idx_bookings_customer_created_at
  ON bookings (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_details_room_booking
  ON booking_details (room_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_details_booking
  ON booking_details (booking_id);
