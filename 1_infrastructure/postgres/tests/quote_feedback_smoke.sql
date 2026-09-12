\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  test_customer_id UUID := uuid_generate_v4();
  test_booking_id UUID := uuid_generate_v4();
  test_quote_id UUID;
  test_room_type_id INT;
  generated_events INT;
  accepted_events INT;
  canceled_events INT;
  dataset_acceptance BOOLEAN;
  dataset_cancellation BOOLEAN;
  dataset_outcome TEXT;
  snapshot_sellable INT;
  snapshot_booked INT;
  snapshot_occupancy NUMERIC;
BEGIN
  INSERT INTO customers (customer_id, full_name, email, password_hash)
  VALUES (
    test_customer_id,
    'Quote Feedback Migration Test',
    'quote-feedback-migration-test@example.invalid',
    'not-a-login-credential'
  );

  INSERT INTO room_types (name, base_price, capacity)
  VALUES ('Quote Feedback Test Room', 100, 2)
  RETURNING type_id INTO test_room_type_id;

  INSERT INTO rooms (room_number, type_id, current_status)
  VALUES ('QF-TEST', test_room_type_id, 'Available');

  INSERT INTO pricing_quotes (
    room_type_id,
    room_type_name_snapshot,
    capacity_snapshot,
    check_in_date,
    check_out_date,
    guest_count,
    total_of_special_requests,
    lead_time,
    is_weekend,
    rooms_available,
    base_price,
    ai_multiplier,
    nightly_price,
    total_price,
    pricing_source,
    settings_version,
    ai_model_version,
    ai_training_run_id,
    ai_feature_contract_version,
    expires_at
  ) VALUES (
    test_room_type_id,
    'Quote Feedback Test Room',
    2,
    CURRENT_DATE + 30,
    CURRENT_DATE + 32,
    2,
    0,
    30,
    TRUE,
    1,
    100,
    1.2,
    120,
    240,
    'ai',
    1,
    'migration-test-model',
    'migration-test-run',
    '2.0.0',
    CURRENT_TIMESTAMP + INTERVAL '15 minutes'
  )
  RETURNING quote_id,
            rooms_sellable_snapshot,
            rooms_booked_snapshot,
            occupancy_ratio_snapshot
  INTO test_quote_id, snapshot_sellable, snapshot_booked, snapshot_occupancy;

  IF snapshot_sellable <> 1 OR snapshot_booked <> 0 OR snapshot_occupancy <> 0 THEN
    RAISE EXCEPTION 'Inventory snapshot was not captured correctly';
  END IF;

  SELECT COUNT(*) INTO generated_events
  FROM pricing_quote_events
  WHERE quote_id = test_quote_id AND event_type = 'quote.generated.v1';
  IF generated_events <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one generated quote event';
  END IF;

  BEGIN
    UPDATE pricing_quotes
    SET nightly_price = nightly_price + 1
    WHERE quote_id = test_quote_id;
    RAISE EXCEPTION 'Expected pricing quote snapshot mutation to be blocked';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  INSERT INTO bookings (
    booking_id,
    customer_id,
    check_in_date,
    check_out_date,
    guest_count,
    status
  ) VALUES (
    test_booking_id,
    test_customer_id,
    CURRENT_DATE + 30,
    CURRENT_DATE + 32,
    2,
    'Confirmed'
  );

  UPDATE pricing_quotes
  SET booking_id = test_booking_id,
      customer_id = test_customer_id,
      accepted_at = CURRENT_TIMESTAMP
  WHERE quote_id = test_quote_id;

  SELECT COUNT(*) INTO accepted_events
  FROM pricing_quote_events
  WHERE quote_id = test_quote_id AND event_type = 'quote.accepted.v1';
  IF accepted_events <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one accepted quote event';
  END IF;

  BEGIN
    UPDATE pricing_quotes
    SET accepted_at = accepted_at + INTERVAL '1 second'
    WHERE quote_id = test_quote_id;
    RAISE EXCEPTION 'Expected accepted quote linkage mutation to be blocked';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  UPDATE bookings SET status = 'Canceled' WHERE booking_id = test_booking_id;

  SELECT COUNT(*) INTO canceled_events
  FROM pricing_quote_events
  WHERE quote_id = test_quote_id AND event_type = 'booking.canceled.v1';
  IF canceled_events <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one booking cancellation event';
  END IF;

  SELECT acceptance_label, cancellation_label, latest_outcome
  INTO dataset_acceptance, dataset_cancellation, dataset_outcome
  FROM pricing_quote_training_dataset_v1
  WHERE quote_id = test_quote_id;
  IF dataset_acceptance IS DISTINCT FROM TRUE
     OR dataset_cancellation IS DISTINCT FROM TRUE
     OR dataset_outcome <> 'canceled' THEN
    RAISE EXCEPTION 'Training dataset labels are inconsistent';
  END IF;

  BEGIN
    UPDATE pricing_quote_events
    SET source = 'illegal-mutation'
    WHERE quote_id = test_quote_id;
    RAISE EXCEPTION 'Append-only event ledger accepted an update';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      NULL;
  END;
END;
$$;

ROLLBACK;
