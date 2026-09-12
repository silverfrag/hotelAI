-- 016_smart_room_upgrades.sql
-- Enables Smart Room Upgrades to equal or higher tier room types
-- when authorized via session configuration: hotelai.allow_room_upgrade = 'on'

CREATE OR REPLACE FUNCTION enforce_booking_detail_workflow()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE booking_row bookings%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('hotelai.allow_room_upgrade', true) = 'on' THEN
      IF ROW(NEW.detail_id, NEW.booking_id, NEW.applied_price)
         IS DISTINCT FROM ROW(OLD.detail_id, OLD.booking_id, OLD.applied_price) THEN
        RAISE EXCEPTION 'Booking detail identity and price snapshot are immutable' USING ERRCODE = '55000';
      END IF;
    ELSE
      IF ROW(NEW.detail_id, NEW.booking_id, NEW.applied_price, NEW.room_type_name_snapshot)
         IS DISTINCT FROM ROW(OLD.detail_id, OLD.booking_id, OLD.applied_price, OLD.room_type_name_snapshot) THEN
        RAISE EXCEPTION 'Booking detail identity and price snapshot are immutable' USING ERRCODE = '55000';
      END IF;
    END IF;
    IF NEW.room_id = OLD.room_id THEN RETURN NEW; END IF;
  END IF;

  SELECT * INTO booking_row FROM bookings WHERE booking_id = NEW.booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown booking' USING ERRCODE = '23503'; END IF;
  IF TG_OP = 'UPDATE' AND booking_row.status NOT IN ('Confirmed', 'CheckedIn') THEN
    RAISE EXCEPTION 'Only confirmed bookings or active stays can change rooms' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM payment_transactions WHERE booking_id = NEW.booking_id) THEN
    RAISE EXCEPTION 'Paid booking details cannot be extended' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM rooms WHERE room_id = NEW.room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown room' USING ERRCODE = '23503'; END IF;
  IF (booking_row.status IN ('Confirmed', 'CheckedIn')
       OR (booking_row.status = 'Pending' AND booking_row.pending_expires_at > clock_timestamp()))
     AND EXISTS (
       SELECT 1 FROM booking_details detail
       INNER JOIN bookings occupied ON occupied.booking_id = detail.booking_id
       WHERE detail.room_id = NEW.room_id AND detail.detail_id <> NEW.detail_id
         AND (occupied.status IN ('Confirmed', 'CheckedIn')
           OR (occupied.status = 'Pending' AND occupied.pending_expires_at > clock_timestamp()))
         AND occupied.check_in_date < booking_row.check_out_date
         AND occupied.check_out_date > booking_row.check_in_date
     ) THEN
    RAISE EXCEPTION 'Room is already reserved for these dates' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_booking_detail_assignment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_room_type_id INT;
  new_room_type_id INT;
  target_room_number VARCHAR(10);
  source_base_price NUMERIC(10, 2);
  target_base_price NUMERIC(10, 2);
  target_room_type_name VARCHAR(50);
BEGIN
  IF NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    IF NEW.room_assignment_version <> OLD.room_assignment_version + 1 THEN
      RAISE EXCEPTION 'Room assignment version must increase exactly once'
        USING ERRCODE = '23514';
    END IF;

    SELECT room.type_id
    INTO old_room_type_id
    FROM rooms room
    WHERE room.room_id = OLD.room_id;

    SELECT room.type_id, room.room_number, rt.base_price, rt.name
    INTO new_room_type_id, target_room_number, target_base_price, target_room_type_name
    FROM rooms room
    JOIN room_types rt ON rt.type_id = room.type_id
    WHERE room.room_id = NEW.room_id;

    IF old_room_type_id IS NULL OR new_room_type_id IS NULL THEN
      RAISE EXCEPTION 'Room reassignment references an unknown room'
        USING ERRCODE = '23503';
    END IF;

    IF old_room_type_id <> new_room_type_id THEN
      IF current_setting('hotelai.allow_room_upgrade', true) = 'on' THEN
        SELECT base_price INTO source_base_price FROM room_types WHERE type_id = old_room_type_id;
        IF target_base_price < source_base_price THEN
          RAISE EXCEPTION 'Room upgrade destination must have equal or higher tier value'
            USING ERRCODE = '23514';
        END IF;
        NEW.room_type_name_snapshot := target_room_type_name;
      ELSE
        RAISE EXCEPTION 'Room reassignment must remain within room type %',
          old_room_type_id
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.room_number_snapshot IS DISTINCT FROM target_room_number THEN
      RAISE EXCEPTION 'Room number snapshot must match destination room %',
        target_room_number
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.room_assignment_version IS DISTINCT FROM OLD.room_assignment_version THEN
    RAISE EXCEPTION 'Room assignment version cannot change without changing room_id'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_booking_room_assignment_event_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  aggregate_booking_id UUID;
  aggregate_room_id INT;
  aggregate_version INT;
  source_room_type_id INT;
  target_room_type_id INT;
  source_base_price NUMERIC(10, 2);
  target_base_price NUMERIC(10, 2);
BEGIN
  SELECT detail.booking_id,
         detail.room_id,
         detail.room_assignment_version,
         source_room.type_id,
         source_rt.base_price
  INTO aggregate_booking_id,
       aggregate_room_id,
       aggregate_version,
       source_room_type_id,
       source_base_price
  FROM booking_details detail
  INNER JOIN rooms source_room ON source_room.room_id = detail.room_id
  INNER JOIN room_types source_rt ON source_rt.type_id = source_room.type_id
  WHERE detail.detail_id = NEW.booking_detail_id
  FOR UPDATE OF detail;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking detail % does not exist', NEW.booking_detail_id
      USING ERRCODE = '23503';
  END IF;

  IF aggregate_booking_id IS DISTINCT FROM NEW.booking_id THEN
    RAISE EXCEPTION 'Assignment event booking does not own booking detail %',
      NEW.booking_detail_id
      USING ERRCODE = '23514';
  END IF;

  IF aggregate_room_id IS DISTINCT FROM NEW.from_room_id
     OR aggregate_version IS DISTINCT FROM NEW.from_version THEN
    RAISE EXCEPTION
      'Stale room assignment for detail %: expected room/version %/%, current %/%',
      NEW.booking_detail_id,
      NEW.from_room_id, NEW.from_version,
      aggregate_room_id, aggregate_version
      USING ERRCODE = '40001';
  END IF;

  SELECT room.type_id, target_rt.base_price
  INTO target_room_type_id, target_base_price
  FROM rooms room
  INNER JOIN room_types target_rt ON target_rt.type_id = room.type_id
  WHERE room.room_id = NEW.to_room_id;

  IF target_room_type_id IS NULL THEN
    RAISE EXCEPTION 'Destination room % does not exist', NEW.to_room_id
      USING ERRCODE = '23503';
  END IF;

  IF source_room_type_id <> target_room_type_id THEN
    IF current_setting('hotelai.allow_room_upgrade', true) = 'on' THEN
      IF target_base_price < source_base_price THEN
        RAISE EXCEPTION 'Room upgrade destination must have equal or higher tier value'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Room reassignment must remain within room type %',
        source_room_type_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;
