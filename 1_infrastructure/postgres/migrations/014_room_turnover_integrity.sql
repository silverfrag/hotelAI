\set ON_ERROR_STOP on

BEGIN;

-- OPS-001A: auditable housekeeping lifecycle and room reassignment integrity.
--
-- The event rows are commands as well as immutable audit facts. Application
-- transactions must insert the matching event first and then update the
-- aggregate. Reciprocal, deferred constraint triggers ensure neither half can
-- commit without the other half.

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS housekeeping_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS housekeeping_version INT,
  ADD COLUMN IF NOT EXISTS housekeeping_updated_at TIMESTAMPTZ;

-- Existing rooms are deliberately upgraded as Ready. Subsequent changes must
-- use the audited transition contract installed below.
UPDATE rooms
SET housekeeping_status = COALESCE(housekeeping_status, 'Ready'),
    housekeeping_version = COALESCE(housekeeping_version, 1),
    housekeeping_updated_at = COALESCE(housekeeping_updated_at, clock_timestamp())
WHERE housekeeping_status IS NULL
   OR housekeeping_version IS NULL
   OR housekeeping_updated_at IS NULL;

ALTER TABLE rooms
  ALTER COLUMN housekeeping_status SET DEFAULT 'Ready',
  ALTER COLUMN housekeeping_status SET NOT NULL,
  ALTER COLUMN housekeeping_version SET DEFAULT 1,
  ALTER COLUMN housekeeping_version SET NOT NULL,
  ALTER COLUMN housekeeping_updated_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN housekeeping_updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass
      AND conname = 'rooms_housekeeping_status_check'
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_housekeeping_status_check
      CHECK (housekeeping_status IN ('Ready', 'Dirty', 'Cleaning'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass
      AND conname = 'rooms_housekeeping_version_check'
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_housekeeping_version_check
      CHECK (housekeeping_version >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass
      AND conname = 'rooms_occupied_housekeeping_ready_check'
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_occupied_housekeeping_ready_check
      CHECK (current_status <> 'Occupied' OR housekeeping_status = 'Ready');
  END IF;
END
$$;

ALTER TABLE booking_details
  ADD COLUMN IF NOT EXISTS room_assignment_version INT;

UPDATE booking_details
SET room_assignment_version = 1
WHERE room_assignment_version IS NULL;

ALTER TABLE booking_details
  ALTER COLUMN room_assignment_version SET DEFAULT 1,
  ALTER COLUMN room_assignment_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'booking_details'::regclass
      AND conname = 'booking_details_room_assignment_version_check'
  ) THEN
    ALTER TABLE booking_details
      ADD CONSTRAINT booking_details_room_assignment_version_check
      CHECK (room_assignment_version >= 1);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS room_housekeeping_events (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id INT NOT NULL,
  from_status VARCHAR(20) NOT NULL,
  to_status VARCHAR(20) NOT NULL,
  from_version INT NOT NULL,
  to_version INT NOT NULL,
  reason VARCHAR(500) NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  changed_by UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT room_housekeeping_events_room_fk
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE RESTRICT,
  CONSTRAINT room_housekeeping_events_changed_by_fk
    FOREIGN KEY (changed_by) REFERENCES customers(customer_id) ON DELETE RESTRICT,
  CONSTRAINT room_housekeeping_events_status_check CHECK (
    from_status IN ('Ready', 'Dirty', 'Cleaning')
    AND to_status IN ('Ready', 'Dirty', 'Cleaning')
  ),
  CONSTRAINT room_housekeeping_events_transition_check CHECK (
    (from_status = 'Ready' AND to_status = 'Dirty')
    OR (from_status = 'Dirty' AND to_status = 'Cleaning')
    OR (from_status = 'Cleaning' AND to_status = 'Ready')
    OR (from_status = 'Cleaning' AND to_status = 'Dirty')
  ),
  CONSTRAINT room_housekeeping_events_version_check
    CHECK (from_version >= 1 AND to_version = from_version + 1),
  CONSTRAINT room_housekeeping_events_reason_check
    CHECK (char_length(BTRIM(reason)) BETWEEN 10 AND 500),
  CONSTRAINT room_housekeeping_events_idempotency_key_check
    CHECK (char_length(BTRIM(idempotency_key)) BETWEEN 8 AND 100),
  CONSTRAINT room_housekeeping_events_idempotency_unique
    UNIQUE (room_id, idempotency_key),
  CONSTRAINT room_housekeeping_events_target_version_unique
    UNIQUE (room_id, to_version)
);

CREATE TABLE IF NOT EXISTS booking_room_assignment_events (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL,
  booking_detail_id UUID NOT NULL,
  from_room_id INT NOT NULL,
  to_room_id INT NOT NULL,
  from_version INT NOT NULL,
  to_version INT NOT NULL,
  reason VARCHAR(500) NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  changed_by UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT booking_room_assignment_events_booking_fk
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE RESTRICT,
  CONSTRAINT booking_room_assignment_events_detail_fk
    FOREIGN KEY (booking_detail_id) REFERENCES booking_details(detail_id) ON DELETE RESTRICT,
  CONSTRAINT booking_room_assignment_events_from_room_fk
    FOREIGN KEY (from_room_id) REFERENCES rooms(room_id) ON DELETE RESTRICT,
  CONSTRAINT booking_room_assignment_events_to_room_fk
    FOREIGN KEY (to_room_id) REFERENCES rooms(room_id) ON DELETE RESTRICT,
  CONSTRAINT booking_room_assignment_events_changed_by_fk
    FOREIGN KEY (changed_by) REFERENCES customers(customer_id) ON DELETE RESTRICT,
  CONSTRAINT booking_room_assignment_events_distinct_rooms_check
    CHECK (from_room_id <> to_room_id),
  CONSTRAINT booking_room_assignment_events_version_check
    CHECK (from_version >= 1 AND to_version = from_version + 1),
  CONSTRAINT booking_room_assignment_events_reason_check
    CHECK (char_length(BTRIM(reason)) BETWEEN 10 AND 500),
  CONSTRAINT booking_room_assignment_events_idempotency_key_check
    CHECK (char_length(BTRIM(idempotency_key)) BETWEEN 8 AND 100),
  CONSTRAINT booking_room_assignment_events_idempotency_unique
    UNIQUE (booking_detail_id, idempotency_key),
  CONSTRAINT booking_room_assignment_events_target_version_unique
    UNIQUE (booking_detail_id, to_version)
);

-- A pre-release draft of this migration did not include Cleaning -> Dirty.
-- Upgrade only that draft; normal reapplication avoids locking and rescanning
-- a potentially large event ledger.
DO $$
DECLARE
  transition_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(constraint_row.oid)
  INTO transition_definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'room_housekeeping_events'::regclass
    AND constraint_row.conname = 'room_housekeeping_events_transition_check';

  IF transition_definition IS NULL
     OR POSITION(
       '''Cleaning''::text) AND ((to_status)::text = ''Dirty''::text)'
       IN transition_definition
     ) = 0 THEN
    ALTER TABLE room_housekeeping_events
      DROP CONSTRAINT IF EXISTS room_housekeeping_events_transition_check;
    ALTER TABLE room_housekeeping_events
      ADD CONSTRAINT room_housekeeping_events_transition_check CHECK (
        (from_status = 'Ready' AND to_status = 'Dirty')
        OR (from_status = 'Dirty' AND to_status = 'Cleaning')
        OR (from_status = 'Cleaning' AND to_status = 'Ready')
        OR (from_status = 'Cleaning' AND to_status = 'Dirty')
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_room_housekeeping_events_room_occurred
  ON room_housekeeping_events (room_id, occurred_at DESC, event_id DESC);

CREATE INDEX IF NOT EXISTS idx_room_housekeeping_events_status_occurred
  ON room_housekeeping_events (to_status, occurred_at ASC, event_id ASC);

CREATE INDEX IF NOT EXISTS idx_booking_room_assignment_events_booking_occurred
  ON booking_room_assignment_events (booking_id, occurred_at DESC, event_id DESC);

CREATE OR REPLACE FUNCTION enforce_room_housekeeping_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.housekeeping_version := 1;
  NEW.housekeeping_updated_at := clock_timestamp();

  IF NEW.current_status = 'Occupied' AND NEW.housekeeping_status <> 'Ready' THEN
    RAISE EXCEPTION 'An occupied room must have housekeeping status Ready'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_room_housekeeping_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.housekeeping_status IS DISTINCT FROM OLD.housekeeping_status THEN
    IF NOT (
      (OLD.housekeeping_status = 'Ready' AND NEW.housekeeping_status = 'Dirty')
      OR (OLD.housekeeping_status = 'Dirty' AND NEW.housekeeping_status = 'Cleaning')
      OR (OLD.housekeeping_status = 'Cleaning' AND NEW.housekeeping_status = 'Ready')
      OR (OLD.housekeeping_status = 'Cleaning' AND NEW.housekeeping_status = 'Dirty')
    ) THEN
      RAISE EXCEPTION 'Invalid housekeeping transition: % -> %',
        OLD.housekeeping_status, NEW.housekeeping_status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.housekeeping_version <> OLD.housekeeping_version + 1 THEN
      RAISE EXCEPTION 'Housekeeping version must increase exactly once: % -> %',
        OLD.housekeeping_version, NEW.housekeeping_version
        USING ERRCODE = '40001';
    END IF;

    -- Ignore caller timestamps: the database owns operational time.
    NEW.housekeeping_updated_at := clock_timestamp();
  ELSIF NEW.housekeeping_version IS DISTINCT FROM OLD.housekeeping_version THEN
    RAISE EXCEPTION 'Housekeeping version cannot change without a status transition'
      USING ERRCODE = '55000';
  ELSE
    NEW.housekeeping_updated_at := OLD.housekeeping_updated_at;
  END IF;

  IF NEW.current_status = 'Occupied' AND NEW.housekeeping_status <> 'Ready' THEN
    RAISE EXCEPTION 'An occupied room must have housekeeping status Ready'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_housekeeping_insert_guard_trigger ON rooms;
CREATE TRIGGER rooms_housekeeping_insert_guard_trigger
BEFORE INSERT ON rooms
FOR EACH ROW
EXECUTE FUNCTION enforce_room_housekeeping_insert();

DROP TRIGGER IF EXISTS rooms_housekeeping_update_guard_trigger ON rooms;
CREATE TRIGGER rooms_housekeeping_update_guard_trigger
BEFORE UPDATE ON rooms
FOR EACH ROW
EXECUTE FUNCTION enforce_room_housekeeping_update();

CREATE OR REPLACE FUNCTION validate_room_housekeeping_event_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  aggregate_status VARCHAR(20);
  aggregate_version INT;
BEGIN
  SELECT room.housekeeping_status, room.housekeeping_version
  INTO aggregate_status, aggregate_version
  FROM rooms room
  WHERE room.room_id = NEW.room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Housekeeping room % does not exist', NEW.room_id
      USING ERRCODE = '23503';
  END IF;

  IF aggregate_status IS DISTINCT FROM NEW.from_status
     OR aggregate_version IS DISTINCT FROM NEW.from_version THEN
    RAISE EXCEPTION
      'Stale housekeeping transition for room %: expected %/%, current %/%',
      NEW.room_id, NEW.from_status, NEW.from_version,
      aggregate_status, aggregate_version
      USING ERRCODE = '40001';
  END IF;

  IF NOT (
    (NEW.from_status = 'Ready' AND NEW.to_status = 'Dirty')
    OR (NEW.from_status = 'Dirty' AND NEW.to_status = 'Cleaning')
    OR (NEW.from_status = 'Cleaning' AND NEW.to_status = 'Ready')
    OR (NEW.from_status = 'Cleaning' AND NEW.to_status = 'Dirty')
  ) THEN
    RAISE EXCEPTION 'Invalid housekeeping event transition: % -> %',
      NEW.from_status, NEW.to_status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.to_version <> NEW.from_version + 1 THEN
    RAISE EXCEPTION 'Housekeeping event version must increase exactly once'
      USING ERRCODE = '23514';
  END IF;

  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS room_housekeeping_events_insert_guard_trigger
  ON room_housekeeping_events;
CREATE TRIGGER room_housekeeping_events_insert_guard_trigger
BEFORE INSERT ON room_housekeeping_events
FOR EACH ROW
EXECUTE FUNCTION validate_room_housekeeping_event_insert();

CREATE OR REPLACE FUNCTION require_housekeeping_event_for_room_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM room_housekeeping_events event
    WHERE event.room_id = NEW.room_id
      AND event.from_status = OLD.housekeeping_status
      AND event.to_status = NEW.housekeeping_status
      AND event.from_version = OLD.housekeeping_version
      AND event.to_version = NEW.housekeeping_version
  ) THEN
    RAISE EXCEPTION
      'Room % housekeeping mutation %/% -> %/% requires a matching event',
      NEW.room_id,
      OLD.housekeeping_status, OLD.housekeeping_version,
      NEW.housekeeping_status, NEW.housekeeping_version
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION require_room_mutation_for_housekeeping_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM rooms room
    WHERE room.room_id = NEW.room_id
      AND room.housekeeping_status = NEW.to_status
      AND room.housekeeping_version = NEW.to_version
  ) THEN
    RAISE EXCEPTION
      'Housekeeping event % requires its room mutation in the same transaction',
      NEW.event_id
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rooms_housekeeping_event_required_trigger ON rooms;
CREATE CONSTRAINT TRIGGER rooms_housekeeping_event_required_trigger
AFTER UPDATE OF housekeeping_status, housekeeping_version ON rooms
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  OLD.housekeeping_status IS DISTINCT FROM NEW.housekeeping_status
  OR OLD.housekeeping_version IS DISTINCT FROM NEW.housekeeping_version
)
EXECUTE FUNCTION require_housekeeping_event_for_room_mutation();

DROP TRIGGER IF EXISTS room_housekeeping_events_room_mutation_required_trigger
  ON room_housekeeping_events;
CREATE CONSTRAINT TRIGGER room_housekeeping_events_room_mutation_required_trigger
AFTER INSERT ON room_housekeeping_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_room_mutation_for_housekeeping_event();

CREATE OR REPLACE FUNCTION enforce_booking_detail_assignment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.room_assignment_version := 1;
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
BEGIN
  IF NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    IF NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
      RAISE EXCEPTION 'A room reassignment cannot change booking_id'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.room_assignment_version <> OLD.room_assignment_version + 1 THEN
      RAISE EXCEPTION 'Room assignment version must increase exactly once: % -> %',
        OLD.room_assignment_version, NEW.room_assignment_version
        USING ERRCODE = '40001';
    END IF;

    IF NEW.applied_price IS DISTINCT FROM OLD.applied_price
       OR NEW.room_type_name_snapshot IS DISTINCT FROM OLD.room_type_name_snapshot THEN
      RAISE EXCEPTION
        'Room reassignment must preserve applied price and room type snapshot'
        USING ERRCODE = '55000';
    END IF;

    SELECT room.type_id
    INTO old_room_type_id
    FROM rooms room
    WHERE room.room_id = OLD.room_id;

    SELECT room.type_id, room.room_number
    INTO new_room_type_id, target_room_number
    FROM rooms room
    WHERE room.room_id = NEW.room_id;

    IF old_room_type_id IS NULL OR new_room_type_id IS NULL THEN
      RAISE EXCEPTION 'Room reassignment references an unknown room'
        USING ERRCODE = '23503';
    END IF;

    IF old_room_type_id <> new_room_type_id THEN
      RAISE EXCEPTION 'Room reassignment must remain within room type %',
        old_room_type_id
        USING ERRCODE = '23514';
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

DROP TRIGGER IF EXISTS booking_details_assignment_insert_guard_trigger
  ON booking_details;
CREATE TRIGGER booking_details_assignment_insert_guard_trigger
BEFORE INSERT ON booking_details
FOR EACH ROW
EXECUTE FUNCTION enforce_booking_detail_assignment_insert();

DROP TRIGGER IF EXISTS booking_details_assignment_update_guard_trigger
  ON booking_details;
CREATE TRIGGER booking_details_assignment_update_guard_trigger
BEFORE UPDATE ON booking_details
FOR EACH ROW
EXECUTE FUNCTION enforce_booking_detail_assignment_update();

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
BEGIN
  SELECT detail.booking_id,
         detail.room_id,
         detail.room_assignment_version,
         source_room.type_id
  INTO aggregate_booking_id,
       aggregate_room_id,
       aggregate_version,
       source_room_type_id
  FROM booking_details detail
  INNER JOIN rooms source_room ON source_room.room_id = detail.room_id
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

  SELECT room.type_id
  INTO target_room_type_id
  FROM rooms room
  WHERE room.room_id = NEW.to_room_id;

  IF target_room_type_id IS NULL THEN
    RAISE EXCEPTION 'Destination room % does not exist', NEW.to_room_id
      USING ERRCODE = '23503';
  END IF;

  IF source_room_type_id <> target_room_type_id THEN
    RAISE EXCEPTION 'Room reassignment must remain within room type %',
      source_room_type_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.from_room_id = NEW.to_room_id
     OR NEW.to_version <> NEW.from_version + 1 THEN
    RAISE EXCEPTION 'Assignment event requires a distinct room and one version increment'
      USING ERRCODE = '23514';
  END IF;

  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_room_assignment_events_insert_guard_trigger
  ON booking_room_assignment_events;
CREATE TRIGGER booking_room_assignment_events_insert_guard_trigger
BEFORE INSERT ON booking_room_assignment_events
FOR EACH ROW
EXECUTE FUNCTION validate_booking_room_assignment_event_insert();

CREATE OR REPLACE FUNCTION require_assignment_event_for_detail_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM booking_room_assignment_events event
    WHERE event.booking_id = NEW.booking_id
      AND event.booking_detail_id = NEW.detail_id
      AND event.from_room_id = OLD.room_id
      AND event.to_room_id = NEW.room_id
      AND event.from_version = OLD.room_assignment_version
      AND event.to_version = NEW.room_assignment_version
  ) THEN
    RAISE EXCEPTION
      'Booking detail % room mutation %/% -> %/% requires a matching event',
      NEW.detail_id,
      OLD.room_id, OLD.room_assignment_version,
      NEW.room_id, NEW.room_assignment_version
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION require_detail_mutation_for_assignment_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM booking_details detail
    WHERE detail.detail_id = NEW.booking_detail_id
      AND detail.booking_id = NEW.booking_id
      AND detail.room_id = NEW.to_room_id
      AND detail.room_assignment_version = NEW.to_version
  ) THEN
    RAISE EXCEPTION
      'Room assignment event % requires its booking detail mutation in the same transaction',
      NEW.event_id
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS booking_details_assignment_event_required_trigger
  ON booking_details;
CREATE CONSTRAINT TRIGGER booking_details_assignment_event_required_trigger
AFTER UPDATE OF room_id, room_assignment_version ON booking_details
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  OLD.room_id IS DISTINCT FROM NEW.room_id
  OR OLD.room_assignment_version IS DISTINCT FROM NEW.room_assignment_version
)
EXECUTE FUNCTION require_assignment_event_for_detail_mutation();

DROP TRIGGER IF EXISTS booking_room_assignment_events_detail_mutation_required_trigger
  ON booking_room_assignment_events;
CREATE CONSTRAINT TRIGGER booking_room_assignment_events_detail_mutation_required_trigger
AFTER INSERT ON booking_room_assignment_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_detail_mutation_for_assignment_event();

CREATE OR REPLACE FUNCTION prevent_room_turnover_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('hotelai.allow_room_turnover_cleanup', TRUE) = 'on' THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS room_housekeeping_events_append_only_trigger
  ON room_housekeeping_events;
CREATE TRIGGER room_housekeeping_events_append_only_trigger
BEFORE UPDATE OR DELETE OR TRUNCATE ON room_housekeeping_events
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_room_turnover_ledger_mutation();

DROP TRIGGER IF EXISTS booking_room_assignment_events_append_only_trigger
  ON booking_room_assignment_events;
CREATE TRIGGER booking_room_assignment_events_append_only_trigger
BEFORE UPDATE OR DELETE OR TRUNCATE ON booking_room_assignment_events
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_room_turnover_ledger_mutation();

COMMENT ON COLUMN rooms.housekeeping_status IS
  'Operational housekeeping state. Only Ready rooms may be Occupied.';
COMMENT ON COLUMN rooms.housekeeping_version IS
  'Optimistic concurrency version incremented once per housekeeping transition.';
COMMENT ON TABLE room_housekeeping_events IS
  'Append-only housekeeping transition ledger; insert before mutating rooms.';
COMMENT ON TABLE booking_room_assignment_events IS
  'Append-only room reassignment ledger; insert before mutating booking_details.';

COMMIT;
