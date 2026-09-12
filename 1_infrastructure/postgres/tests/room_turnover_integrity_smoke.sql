\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  actor_id UUID := uuid_generate_v4();
  booking_id_value UUID := uuid_generate_v4();
  detail_id_value UUID := uuid_generate_v4();
  token TEXT := UPPER(SUBSTRING(REPLACE(uuid_generate_v4()::text, '-', '') FROM 1 FOR 6));
  primary_type_id INT;
  other_type_id INT;
  source_room_id INT;
  target_room_id INT;
  spare_room_id INT;
  other_room_id INT;
  original_price NUMERIC(10, 2) := 730000;
  stored_status TEXT;
  stored_version INT;
  stored_room_id INT;
  stored_room_number TEXT;
  stored_price NUMERIC(10, 2);
  stored_type_name TEXT;
  event_time TIMESTAMPTZ;
  room_time TIMESTAMPTZ;
  housekeeping_event_count INT;
  assignment_event_count INT;
BEGIN
  INSERT INTO customers (customer_id, full_name, email, password_hash, role)
  VALUES (
    actor_id,
    'OPS-001A SQL Smoke Admin',
    FORMAT('ops-001a-%s@example.invalid', LOWER(token)),
    'not-a-login-credential',
    'admin'
  );

  INSERT INTO room_types (name, base_price, capacity)
  VALUES (FORMAT('Turnover SQL %s', token), original_price, 2)
  RETURNING type_id INTO primary_type_id;

  INSERT INTO room_types (name, base_price, capacity)
  VALUES (FORMAT('Turnover Other %s', token), original_price, 2)
  RETURNING type_id INTO other_type_id;

  INSERT INTO rooms (type_id, room_number, current_status)
  VALUES (primary_type_id, 'A' || token, 'Available')
  RETURNING room_id, housekeeping_status, housekeeping_version, housekeeping_updated_at
  INTO source_room_id, stored_status, stored_version, room_time;

  IF stored_status <> 'Ready' OR stored_version <> 1 OR room_time IS NULL THEN
    RAISE EXCEPTION 'New rooms must start Ready at housekeeping version 1';
  END IF;

  INSERT INTO rooms (type_id, room_number, current_status)
  VALUES (primary_type_id, 'B' || token, 'Available')
  RETURNING room_id INTO target_room_id;

  INSERT INTO rooms (type_id, room_number, current_status)
  VALUES (primary_type_id, 'C' || token, 'Available')
  RETURNING room_id INTO spare_room_id;

  INSERT INTO rooms (type_id, room_number, current_status)
  VALUES (other_type_id, 'D' || token, 'Available')
  RETURNING room_id INTO other_room_id;

  INSERT INTO bookings (
    booking_id,
    customer_id,
    check_in_date,
    check_out_date,
    guest_count,
    status
  ) VALUES (
    booking_id_value,
    actor_id,
    CURRENT_DATE + 30,
    CURRENT_DATE + 32,
    2,
    'Confirmed'
  );

  INSERT INTO booking_details (
    detail_id,
    booking_id,
    room_id,
    applied_price,
    room_number_snapshot,
    room_type_name_snapshot
  )
  SELECT
    detail_id_value,
    booking_id_value,
    source_room_id,
    original_price,
    room.room_number,
    room_type.name
  FROM rooms room
  INNER JOIN room_types room_type ON room_type.type_id = room.type_id
  WHERE room.room_id = source_room_id;

  -- Valid event-first transition. Both timestamps supplied by the caller must be ignored.
  INSERT INTO room_housekeeping_events (
    room_id,
    from_status,
    to_status,
    from_version,
    to_version,
    reason,
    idempotency_key,
    changed_by,
    occurred_at
  ) VALUES (
    source_room_id,
    'Ready',
    'Dirty',
    1,
    2,
    'Checkout completed and room requires cleaning',
    'sql-ready-dirty:' || token,
    actor_id,
    TIMESTAMPTZ '2000-01-01 00:00:00+00'
  )
  RETURNING occurred_at INTO event_time;

  UPDATE rooms
  SET housekeeping_status = 'Dirty',
      housekeeping_version = 2,
      housekeeping_updated_at = TIMESTAMPTZ '2000-01-01 00:00:00+00'
  WHERE room_id = source_room_id;

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  SELECT housekeeping_status, housekeeping_version, housekeeping_updated_at
  INTO stored_status, stored_version, room_time
  FROM rooms
  WHERE room_id = source_room_id;

  IF stored_status <> 'Dirty'
     OR stored_version <> 2
     OR event_time < clock_timestamp() - INTERVAL '1 minute'
     OR room_time < clock_timestamp() - INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'Ready to Dirty transition or database-owned timestamps are inconsistent';
  END IF;

  -- The lifecycle cannot skip Cleaning.
  BEGIN
    INSERT INTO room_housekeeping_events (
      room_id, from_status, to_status, from_version, to_version,
      reason, idempotency_key, changed_by
    ) VALUES (
      source_room_id, 'Dirty', 'Ready', 2, 3,
      'Skipping cleaning must be rejected', 'sql-invalid-hop:' || token, actor_id
    );
    RAISE EXCEPTION 'Dirty to Ready unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;

  -- An event cannot commit without its matching aggregate mutation.
  BEGIN
    INSERT INTO room_housekeeping_events (
      room_id, from_status, to_status, from_version, to_version,
      reason, idempotency_key, changed_by
    ) VALUES (
      source_room_id, 'Dirty', 'Cleaning', 2, 3,
      'Orphan event must fail deferred validation', 'sql-orphan-event:' || token, actor_id
    );
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Orphan housekeeping event unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- An aggregate mutation cannot commit without its matching event either.
  BEGIN
    UPDATE rooms
    SET housekeeping_status = 'Cleaning', housekeeping_version = 3
    WHERE room_id = source_room_id;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Unaudited housekeeping mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- Exercise Dirty -> Cleaning -> Dirty (failed inspection) -> Cleaning -> Ready.
  INSERT INTO room_housekeeping_events (
    room_id, from_status, to_status, from_version, to_version,
    reason, idempotency_key, changed_by
  ) VALUES (
    source_room_id, 'Dirty', 'Cleaning', 2, 3,
    'Housekeeper started the cleaning task', 'sql-cleaning-1:' || token, actor_id
  );
  UPDATE rooms
  SET housekeeping_status = 'Cleaning', housekeeping_version = 3
  WHERE room_id = source_room_id;

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  INSERT INTO room_housekeeping_events (
    room_id, from_status, to_status, from_version, to_version,
    reason, idempotency_key, changed_by
  ) VALUES (
    source_room_id, 'Cleaning', 'Dirty', 3, 4,
    'Inspection failed and the room needs cleaning again', 'sql-redirty:' || token, actor_id
  );
  UPDATE rooms
  SET housekeeping_status = 'Dirty', housekeeping_version = 4
  WHERE room_id = source_room_id;

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  INSERT INTO room_housekeeping_events (
    room_id, from_status, to_status, from_version, to_version,
    reason, idempotency_key, changed_by
  ) VALUES (
    source_room_id, 'Dirty', 'Cleaning', 4, 5,
    'Housekeeper restarted the cleaning task', 'sql-cleaning-2:' || token, actor_id
  );
  UPDATE rooms
  SET housekeeping_status = 'Cleaning', housekeeping_version = 5
  WHERE room_id = source_room_id;

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  INSERT INTO room_housekeeping_events (
    room_id, from_status, to_status, from_version, to_version,
    reason, idempotency_key, changed_by
  ) VALUES (
    source_room_id, 'Cleaning', 'Ready', 5, 6,
    'Supervisor inspected and released the room', 'sql-ready:' || token, actor_id
  );
  UPDATE rooms
  SET housekeeping_status = 'Ready', housekeeping_version = 6
  WHERE room_id = source_room_id;

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  -- Occupied rooms may never be moved away from Ready.
  UPDATE rooms
  SET current_status = 'Occupied', occupancy_booking_id = booking_id_value
  WHERE room_id = source_room_id;

  BEGIN
    INSERT INTO room_housekeeping_events (
      room_id, from_status, to_status, from_version, to_version,
      reason, idempotency_key, changed_by
    ) VALUES (
      source_room_id, 'Ready', 'Dirty', 6, 7,
      'Occupied room transition must be rejected', 'sql-occupied:' || token, actor_id
    );
    UPDATE rooms
    SET housekeeping_status = 'Dirty', housekeeping_version = 7
    WHERE room_id = source_room_id;
    RAISE EXCEPTION 'Occupied room became non-Ready';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;

  UPDATE rooms
  SET current_status = 'Available', occupancy_booking_id = NULL
  WHERE room_id = source_room_id;

  -- A valid room reassignment preserves price/type lineage and increments once.
  INSERT INTO booking_room_assignment_events (
    booking_id,
    booking_detail_id,
    from_room_id,
    to_room_id,
    from_version,
    to_version,
    reason,
    idempotency_key,
    changed_by,
    occurred_at
  ) VALUES (
    booking_id_value,
    detail_id_value,
    source_room_id,
    target_room_id,
    1,
    2,
    'Guest requested another room of the same type',
    'sql-reassign:' || token,
    actor_id,
    TIMESTAMPTZ '2000-01-01 00:00:00+00'
  );

  UPDATE booking_details detail
  SET room_id = target_room_id,
      room_number_snapshot = target.room_number,
      room_assignment_version = 2
  FROM rooms target
  WHERE detail.detail_id = detail_id_value
    AND target.room_id = target_room_id;

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  SELECT detail.room_id,
         detail.room_number_snapshot,
         detail.applied_price,
         detail.room_type_name_snapshot,
         detail.room_assignment_version
  INTO stored_room_id,
       stored_room_number,
       stored_price,
       stored_type_name,
       stored_version
  FROM booking_details detail
  WHERE detail.detail_id = detail_id_value;

  IF stored_room_id <> target_room_id
     OR stored_room_number <> 'B' || token
     OR stored_price <> original_price
     OR stored_type_name <> FORMAT('Turnover SQL %s', token)
     OR stored_version <> 2 THEN
    RAISE EXCEPTION 'Valid room reassignment did not preserve its immutable snapshots';
  END IF;

  -- No assignment event may exist without its matching detail mutation.
  BEGIN
    INSERT INTO booking_room_assignment_events (
      booking_id, booking_detail_id, from_room_id, to_room_id,
      from_version, to_version, reason, idempotency_key, changed_by
    ) VALUES (
      booking_id_value, detail_id_value, target_room_id, spare_room_id,
      2, 3, 'Orphan assignment event must be rejected',
      'sql-orphan-assignment:' || token, actor_id
    );
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Orphan assignment event unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- No direct detail mutation may bypass the assignment ledger.
  BEGIN
    UPDATE booking_details detail
    SET room_id = spare_room_id,
        room_number_snapshot = spare.room_number,
        room_assignment_version = 3
    FROM rooms spare
    WHERE detail.detail_id = detail_id_value
      AND spare.room_id = spare_room_id;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Unaudited room reassignment unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- Cross-type reassignment is rejected before any aggregate mutation.
  BEGIN
    INSERT INTO booking_room_assignment_events (
      booking_id, booking_detail_id, from_room_id, to_room_id,
      from_version, to_version, reason, idempotency_key, changed_by
    ) VALUES (
      booking_id_value, detail_id_value, target_room_id, other_room_id,
      2, 3, 'Cross type assignment must be rejected',
      'sql-cross-type:' || token, actor_id
    );
    RAISE EXCEPTION 'Cross-type room reassignment unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;

  -- Both operational ledgers are append-only for normal application sessions.
  BEGIN
    UPDATE room_housekeeping_events
    SET reason = 'Illegal mutation of a housekeeping audit row'
    WHERE room_id = source_room_id;
    RAISE EXCEPTION 'Housekeeping ledger accepted an update';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    DELETE FROM room_housekeeping_events WHERE room_id = source_room_id;
    RAISE EXCEPTION 'Housekeeping ledger accepted a delete';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    TRUNCATE room_housekeeping_events;
    RAISE EXCEPTION 'Housekeeping ledger accepted a truncate';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE booking_room_assignment_events
    SET reason = 'Illegal mutation of a room assignment audit row'
    WHERE booking_detail_id = detail_id_value;
    RAISE EXCEPTION 'Assignment ledger accepted an update';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    DELETE FROM booking_room_assignment_events
    WHERE booking_detail_id = detail_id_value;
    RAISE EXCEPTION 'Assignment ledger accepted a delete';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    TRUNCATE booking_room_assignment_events;
    RAISE EXCEPTION 'Assignment ledger accepted a truncate';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  SELECT COUNT(*) INTO housekeeping_event_count
  FROM room_housekeeping_events
  WHERE room_id = source_room_id;

  SELECT COUNT(*) INTO assignment_event_count
  FROM booking_room_assignment_events
  WHERE booking_detail_id = detail_id_value;

  IF housekeeping_event_count <> 5 OR assignment_event_count <> 1 THEN
    RAISE EXCEPTION
      'Ledger row counts changed after rejected writes: housekeeping %, assignment %',
      housekeeping_event_count,
      assignment_event_count;
  END IF;

  RAISE NOTICE 'OPS-001A room turnover integrity smoke passed';
END;
$$;

ROLLBACK;
