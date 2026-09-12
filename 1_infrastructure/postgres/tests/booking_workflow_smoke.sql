\set ON_ERROR_STOP on

-- Transaction-scoped fixtures: no retained policy, customer or booking edits.
BEGIN;
SET LOCAL hotelai.timezone = 'Asia/Bangkok';

DO $$
DECLARE
  actor UUID := uuid_generate_v4();
  customer UUID := uuid_generate_v4();
  room_type INT;
  room INT;
  pending_booking UUID := uuid_generate_v4();
  expired_booking UUID := uuid_generate_v4();
  no_show_booking UUID := uuid_generate_v4();
  stay_booking UUID := uuid_generate_v4();
  competing_booking UUID := uuid_generate_v4();
  legacy_booking UUID := uuid_generate_v4();
  quote UUID;
  payment UUID;
  actual TEXT;
  actual_label BOOLEAN;
  actual_version INT;
  actual_count INT;
  today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date;
  deposit_policy INT := 2147483000;
  pay_at_property_policy INT;
BEGIN
  INSERT INTO customers(customer_id, full_name, email, role)
    VALUES(actor, 'Workflow SQL administrator', actor::text || '@workflow.invalid', 'admin'),
      (customer, 'Workflow SQL customer', customer::text || '@workflow.invalid', 'customer');
  PERFORM set_config('hotelai.actor_id', actor::text, TRUE);
  PERFORM set_config('hotelai.reason', 'Workflow SQL regression fixture', TRUE);
  INSERT INTO room_types(name, base_price, capacity)
    VALUES('Workflow SQL fixture', 100, 2) RETURNING type_id INTO room_type;
  INSERT INTO rooms(type_id, room_number) VALUES(room_type, 'WF-SQL') RETURNING room_id INTO room;
  SELECT version INTO pay_at_property_policy FROM booking_policy_audits
    WHERE deposit_percent = 0 AND require_full_payment_at_checkout = TRUE ORDER BY version LIMIT 1;
  IF pay_at_property_policy IS NULL THEN RAISE EXCEPTION 'Expected initial pay-at-property policy'; END IF;
  INSERT INTO booking_policy_audits(policy_id, version, deposit_percent, pending_ttl_minutes,
    require_full_payment_at_checkout, updated_at, updated_by, reason)
    VALUES(1, deposit_policy, 30, 30, TRUE, clock_timestamp(), actor, 'Rollback-only deposit policy fixture');

  INSERT INTO bookings(booking_id, customer_id, check_in_date, check_out_date, status,
    policy_version, deposit_required, checkout_payment_required, pending_expires_at)
    VALUES(pending_booking, customer, today + 3, today + 5, 'Pending', deposit_policy,
      60, TRUE, clock_timestamp() + interval '30 minutes');
  INSERT INTO booking_details(booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot)
    VALUES(pending_booking, room, 100, 'WF-SQL', 'Workflow SQL fixture');
  BEGIN
    UPDATE bookings SET check_out_date = check_out_date + 1 WHERE booking_id = pending_booking;
    RAISE EXCEPTION 'Expected immutable booking dates';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    UPDATE booking_details SET applied_price = 1 WHERE booking_id = pending_booking;
    RAISE EXCEPTION 'Expected immutable booking price';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    INSERT INTO bookings(booking_id, customer_id, check_in_date, check_out_date)
      VALUES(competing_booking, customer, today + 4, today + 6);
    INSERT INTO booking_details(booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot)
      VALUES(competing_booking, room, 100, 'WF-SQL', 'Workflow SQL fixture');
    RAISE EXCEPTION 'Unexpired Pending hold did not block competing allocation';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO payment_transactions(booking_id, transaction_type, amount, method, idempotency_key, created_by)
    VALUES(pending_booking, 'Payment', 20, 'Cash', 'workflow-sql-partial', actor) RETURNING payment_id INTO payment;
  SELECT status INTO actual FROM bookings WHERE booking_id = pending_booking;
  IF actual <> 'Pending' THEN RAISE EXCEPTION 'Partial deposit confirmed too early'; END IF;
  INSERT INTO payment_transactions(booking_id, transaction_type, amount, method, idempotency_key, created_by)
    VALUES(pending_booking, 'Payment', 40, 'Cash', 'workflow-sql-deposit', actor);
  SELECT status, lifecycle_version INTO actual, actual_version FROM bookings WHERE booking_id = pending_booking;
  IF actual <> 'Confirmed' OR actual_version <> 2 THEN RAISE EXCEPTION 'Deposit did not confirm exactly once'; END IF;
  SELECT COUNT(*) INTO actual_count FROM customer_notifications WHERE booking_id = pending_booking;
  IF actual_count <> 2 THEN RAISE EXCEPTION 'Missing Pending/Confirmed inbox notifications'; END IF;
  SELECT COUNT(*) INTO actual_count FROM event_outbox WHERE aggregate_id = pending_booking::text
    AND aggregate_type = 'booking' AND event_type = 'booking.confirmed.v1';
  IF actual_count <> 1 THEN RAISE EXCEPTION 'Expected one transactional deposit confirmation outbox event'; END IF;
  BEGIN
    INSERT INTO payment_transactions(booking_id, transaction_type, amount, method, idempotency_key, created_by)
      VALUES(pending_booking, 'Payment', 141, 'Cash', 'workflow-sql-overpay', actor);
    RAISE EXCEPTION 'Expected overpayment rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO payment_transactions(booking_id, transaction_type, parent_payment_id, amount, method, idempotency_key, created_by)
      VALUES(pending_booking, 'Refund', payment, 1, 'Cash', 'workflow-sql-live-refund', actor);
    RAISE EXCEPTION 'Expected live booking refund rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE bookings SET status = 'Completed', checked_out_by = actor WHERE booking_id = pending_booking;
    RAISE EXCEPTION 'Expected fictitious stay completion rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE bookings SET status = 'CheckedIn', checked_in_by = actor WHERE booking_id = pending_booking;
    RAISE EXCEPTION 'Expected future check-in rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE payment_transactions SET amount = 1 WHERE payment_id = payment;
    RAISE EXCEPTION 'Expected payment mutation rejection';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  UPDATE customer_notifications SET read_at = clock_timestamp() WHERE booking_id = pending_booking;
  BEGIN
    UPDATE customer_notifications SET read_at = NULL WHERE booking_id = pending_booking;
    RAISE EXCEPTION 'Expected notification read timestamp immutability';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;

  INSERT INTO bookings(booking_id, customer_id, check_in_date, check_out_date, status,
    policy_version, deposit_required, checkout_payment_required, pending_expires_at)
    VALUES(expired_booking, customer, today + 10, today + 12, 'Pending', deposit_policy,
      60, TRUE, clock_timestamp() - interval '1 second');
  INSERT INTO booking_details(booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot)
    VALUES(expired_booking, room, 100, 'WF-SQL', 'Workflow SQL fixture');
  INSERT INTO pricing_quotes(customer_id, booking_id, room_type_id, room_type_name_snapshot,
    capacity_snapshot, check_in_date, check_out_date, guest_count, total_of_special_requests,
    lead_time, is_weekend, rooms_available, base_price, ai_multiplier, nightly_price, total_price,
    pricing_source, settings_version, expires_at, accepted_at)
    VALUES(customer, expired_booking, room_type, 'Workflow SQL fixture', 2, today + 10, today + 12,
      1, 0, 10, FALSE, 1, 100, 1, 100, 200, 'base', 1, clock_timestamp() + interval '15 minutes', clock_timestamp())
    RETURNING quote_id INTO quote;
  SELECT latest_outcome, completed_stay_label INTO actual, actual_label
    FROM pricing_quote_training_dataset_v1 WHERE quote_id = quote;
  IF actual <> 'pending' OR actual_label IS NOT NULL THEN RAISE EXCEPTION 'Pending stay was not censored'; END IF;
  BEGIN
    INSERT INTO payment_transactions(booking_id, transaction_type, amount, method, idempotency_key, created_by)
      VALUES(expired_booking, 'Payment', 60, 'Cash', 'workflow-sql-expired-pay', actor);
    RAISE EXCEPTION 'Expected expired hold payment rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE bookings SET status = 'Expired' WHERE booking_id = expired_booking;
  SELECT latest_outcome, completed_stay_label INTO actual, actual_label
    FROM pricing_quote_training_dataset_v1 WHERE quote_id = quote;
  IF actual <> 'booking_expired' OR actual_label IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Expired booking polluted completed-stay labels'; END IF;

  INSERT INTO bookings(booking_id, customer_id, check_in_date, check_out_date, status,
    policy_version, deposit_required, checkout_payment_required)
    VALUES(no_show_booking, customer, today - 3, today - 1, 'Confirmed', pay_at_property_policy, 0, TRUE);
  INSERT INTO booking_details(booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot)
    VALUES(no_show_booking, room, 100, 'WF-SQL', 'Workflow SQL fixture');
  INSERT INTO payment_transactions(booking_id, transaction_type, amount, method, idempotency_key, created_by)
    VALUES(no_show_booking, 'Payment', 20, 'Cash', 'workflow-sql-noshow-pay', actor) RETURNING payment_id INTO payment;
  INSERT INTO pricing_quotes(customer_id, booking_id, room_type_id, room_type_name_snapshot,
    capacity_snapshot, check_in_date, check_out_date, guest_count, total_of_special_requests,
    lead_time, is_weekend, rooms_available, base_price, ai_multiplier, nightly_price, total_price,
    pricing_source, settings_version, expires_at, accepted_at)
    VALUES(customer, no_show_booking, room_type, 'Workflow SQL fixture', 2, today - 3, today - 1,
      1, 0, 0, FALSE, 1, 100, 1, 100, 200, 'base', 1, clock_timestamp() + interval '15 minutes', clock_timestamp())
    RETURNING quote_id INTO quote;
  UPDATE bookings SET status = 'NoShow', no_show_by = actor, no_show_reason = 'Guest did not arrive as scheduled'
    WHERE booking_id = no_show_booking;
  SELECT latest_outcome, completed_stay_label INTO actual, actual_label
    FROM pricing_quote_training_dataset_v1 WHERE quote_id = quote;
  IF actual <> 'no_show' OR actual_label IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'No-show polluted completed-stay labels'; END IF;
  IF EXISTS (SELECT 1 FROM pricing_quote_events WHERE quote_id = quote AND event_type = 'stay.completed.v1') THEN
    RAISE EXCEPTION 'No-show emitted a fictitious completed stay'; END IF;
  INSERT INTO payment_transactions(booking_id, transaction_type, parent_payment_id, amount, method, idempotency_key, created_by)
    VALUES(no_show_booking, 'Refund', payment, 20, 'Cash', 'workflow-sql-noshow-refund', actor);
  BEGIN
    INSERT INTO payment_transactions(booking_id, transaction_type, parent_payment_id, amount, method, idempotency_key, created_by)
      VALUES(no_show_booking, 'Refund', payment, 1, 'Cash', 'workflow-sql-over-refund', actor);
    RAISE EXCEPTION 'Expected duplicate refund limit rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO bookings(booking_id, customer_id, check_in_date, check_out_date, status,
    policy_version, deposit_required, checkout_payment_required)
    VALUES(stay_booking, customer, today, today + 2, 'Confirmed', pay_at_property_policy, 0, TRUE);
  INSERT INTO booking_details(booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot)
    VALUES(stay_booking, room, 100, 'WF-SQL', 'Workflow SQL fixture');
  UPDATE bookings SET status = 'CheckedIn', checked_in_by = actor WHERE booking_id = stay_booking;
  BEGIN
    UPDATE bookings SET status = 'Completed', checked_out_by = actor WHERE booking_id = stay_booking;
    RAISE EXCEPTION 'Expected unpaid checkout rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO booking_credit_authorizations(booking_id, authorized_amount, reason, idempotency_key, request_hash, authorized_by)
      VALUES(stay_booking, 201, 'Credit SQL fixture rejection', 'workflow-sql-credit-too-much', 'fixture-hash', actor);
    RAISE EXCEPTION 'Expected over-limit credit rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO booking_credit_authorizations(booking_id, authorized_amount, reason, idempotency_key, request_hash, authorized_by)
    VALUES(stay_booking, 100, 'Credit SQL fixture approval', 'workflow-sql-credit', 'fixture-hash', actor);
  BEGIN
    UPDATE bookings SET status = 'Completed', checked_out_by = actor WHERE booking_id = stay_booking;
    RAISE EXCEPTION 'Expected under-authorized unpaid checkout rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO payment_transactions(booking_id, transaction_type, amount, method, idempotency_key, created_by)
    VALUES(stay_booking, 'Payment', 100, 'Cash', 'workflow-sql-checkout-pay', actor);
  UPDATE bookings SET status = 'Completed', checked_out_by = actor WHERE booking_id = stay_booking;
  INSERT INTO payment_transactions(booking_id, transaction_type, amount, method, idempotency_key, created_by)
    VALUES(stay_booking, 'Payment', 100, 'Cash', 'workflow-sql-credit-settle', actor);
  SELECT status, lifecycle_version INTO actual, actual_version FROM bookings WHERE booking_id = stay_booking;
  IF actual <> 'Completed' OR actual_version <> 3 THEN RAISE EXCEPTION 'Audited checkout failed'; END IF;

  INSERT INTO bookings(booking_id, customer_id, check_in_date, check_out_date, status)
    VALUES(legacy_booking, customer, today - 10, today - 8, 'Completed');
  INSERT INTO pricing_quotes(customer_id, booking_id, room_type_id, room_type_name_snapshot,
    capacity_snapshot, check_in_date, check_out_date, guest_count, total_of_special_requests,
    lead_time, is_weekend, rooms_available, base_price, ai_multiplier, nightly_price, total_price,
    pricing_source, settings_version, expires_at, accepted_at)
    VALUES(customer, legacy_booking, room_type, 'Workflow SQL fixture', 2, today - 10, today - 8,
      1, 0, 0, FALSE, 1, 100, 1, 100, 200, 'base', 1, clock_timestamp() + interval '15 minutes', clock_timestamp())
    RETURNING quote_id INTO quote;
  SELECT latest_outcome, completed_stay_label INTO actual, actual_label
    FROM pricing_quote_training_dataset_v1 WHERE quote_id = quote;
  IF actual <> 'legacy_unverified' OR actual_label IS NOT NULL THEN
    RAISE EXCEPTION 'Unaudited legacy completion was mislabeled as a real stay'; END IF;
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
