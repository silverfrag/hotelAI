-- OPS-001B: policy snapshots, pending holds, money guards and auditable outcomes.
-- Legacy rows retain their existing terms. Apply after migration 014.
BEGIN;

CREATE TABLE IF NOT EXISTS booking_policies (
  policy_id SMALLINT PRIMARY KEY CHECK (policy_id = 1),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  deposit_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (deposit_percent BETWEEN 0 AND 100),
  pending_ttl_minutes INT NOT NULL DEFAULT 30 CHECK (pending_ttl_minutes BETWEEN 1 AND 1440),
  require_full_payment_at_checkout BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by UUID REFERENCES customers(customer_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL DEFAULT 'Initial booking policy' CHECK (BTRIM(reason) <> '')
);

CREATE TABLE IF NOT EXISTS booking_policy_audits (
  audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id SMALLINT NOT NULL CHECK (policy_id = 1),
  version INT NOT NULL UNIQUE CHECK (version >= 1),
  deposit_percent NUMERIC(5, 2) NOT NULL CHECK (deposit_percent BETWEEN 0 AND 100),
  pending_ttl_minutes INT NOT NULL CHECK (pending_ttl_minutes BETWEEN 1 AND 1440),
  require_full_payment_at_checkout BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by UUID REFERENCES customers(customer_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (BTRIM(reason) <> '')
);

CREATE OR REPLACE FUNCTION enforce_booking_policy_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.policy_id IS DISTINCT FROM OLD.policy_id THEN
    RAISE EXCEPTION 'Booking policy identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.updated_by IS NULL OR NEW.reason IS NULL OR BTRIM(NEW.reason) = '' THEN
    RAISE EXCEPTION 'Policy changes require an actor and reason' USING ERRCODE = '23514';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION capture_booking_policy_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO booking_policy_audits (
    policy_id, version, deposit_percent, pending_ttl_minutes,
    require_full_payment_at_checkout, updated_at, updated_by, reason
  ) VALUES (
    NEW.policy_id, NEW.version, NEW.deposit_percent, NEW.pending_ttl_minutes,
    NEW.require_full_payment_at_checkout, NEW.updated_at, NEW.updated_by, NEW.reason
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_policies_update_guard_trigger ON booking_policies;
CREATE TRIGGER booking_policies_update_guard_trigger BEFORE UPDATE ON booking_policies
FOR EACH ROW EXECUTE FUNCTION enforce_booking_policy_update();
DROP TRIGGER IF EXISTS booking_policies_audit_trigger ON booking_policies;
CREATE TRIGGER booking_policies_audit_trigger AFTER INSERT OR UPDATE ON booking_policies
FOR EACH ROW EXECUTE FUNCTION capture_booking_policy_audit();

INSERT INTO booking_policies (policy_id) VALUES (1) ON CONFLICT (policy_id) DO NOTHING;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS policy_version INT,
  ADD COLUMN IF NOT EXISTS deposit_required NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkout_payment_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pending_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_by UUID,
  ADD COLUMN IF NOT EXISTS no_show_reason TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_version INT NOT NULL DEFAULT 1;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (
  status IN ('Pending', 'Confirmed', 'CheckedIn', 'Completed', 'Canceled', 'Expired', 'NoShow')
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_policy_version_fk') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_policy_version_fk
      FOREIGN KEY (policy_version) REFERENCES booking_policy_audits(version) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_no_show_by_fk') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_no_show_by_fk
      FOREIGN KEY (no_show_by) REFERENCES customers(customer_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_workflow_check') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_workflow_check CHECK (
      deposit_required >= 0 AND lifecycle_version >= 1
      AND (policy_version IS NULL OR policy_version >= 1)
      AND (status <> 'Pending' OR (policy_version IS NOT NULL AND pending_expires_at IS NOT NULL))
      AND (status <> 'Expired' OR expired_at IS NOT NULL)
      AND (status <> 'NoShow' OR (no_show_at IS NOT NULL AND no_show_by IS NOT NULL
        AND no_show_reason IS NOT NULL AND BTRIM(no_show_reason) <> ''))
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_pending_expiry ON bookings (pending_expires_at, booking_id)
  WHERE status = 'Pending';
CREATE INDEX IF NOT EXISTS idx_bookings_workflow_room_dates ON bookings (check_in_date, check_out_date, booking_id)
  WHERE status IN ('Pending', 'Confirmed', 'CheckedIn');

CREATE TABLE IF NOT EXISTS booking_credit_authorizations (
  authorization_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(booking_id) ON DELETE CASCADE,
  authorized_amount NUMERIC(12, 2) NOT NULL CHECK (authorized_amount > 0),
  reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
  idempotency_key VARCHAR(100) NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  request_hash TEXT NOT NULL CHECK (BTRIM(request_hash) <> ''),
  authorized_by UUID NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_workflow_requests (
  request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL CHECK (BTRIM(action) <> ''),
  idempotency_key VARCHAR(100) NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  request_hash TEXT NOT NULL CHECK (BTRIM(request_hash) <> ''),
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  actor_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_lifecycle_events (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  version INT NOT NULL CHECK (version >= 1),
  actor_id UUID REFERENCES customers(customer_id) ON DELETE RESTRICT,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (booking_id, version),
  CHECK (from_status IS NULL OR from_status IN ('Pending', 'Confirmed', 'CheckedIn', 'Completed', 'Canceled', 'Expired', 'NoShow')),
  CHECK (to_status IN ('Pending', 'Confirmed', 'CheckedIn', 'Completed', 'Canceled', 'Expired', 'NoShow'))
);

CREATE TABLE IF NOT EXISTS customer_notifications (
  notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  event_id UUID NOT NULL UNIQUE REFERENCES booking_lifecycle_events(event_id) ON DELETE CASCADE,
  kind VARCHAR(100) NOT NULL CHECK (BTRIM(kind) <> ''),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_inbox
  ON customer_notifications (customer_id, created_at DESC, notification_id DESC);

-- A NULL policy version denotes a historical/direct legacy booking. The API
-- snapshots the current policy and calculated deposit when inserting new ones.
CREATE OR REPLACE FUNCTION enforce_booking_workflow()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  total_due NUMERIC;
  net_paid NUMERIC;
  credit_limit NUMERIC;
  business_timezone TEXT := COALESCE(NULLIF(current_setting('hotelai.timezone', TRUE), ''), 'Asia/Bangkok');
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.lifecycle_version := 1;
    IF NEW.policy_version IS NOT NULL AND NEW.status NOT IN ('Pending', 'Confirmed') THEN
      RAISE EXCEPTION 'New policy bookings must begin Pending or Confirmed' USING ERRCODE = '23514';
    END IF;
    IF NEW.policy_version IS NOT NULL AND (
      (NEW.status = 'Pending' AND NEW.deposit_required <= 0)
      OR (NEW.status = 'Confirmed' AND NEW.deposit_required <> 0)
      OR NEW.expired_at IS NOT NULL OR NEW.no_show_at IS NOT NULL
      OR NEW.no_show_by IS NOT NULL OR NEW.no_show_reason IS NOT NULL
      OR NEW.checked_in_at IS NOT NULL OR NEW.checked_in_by IS NOT NULL
      OR NEW.checked_out_at IS NOT NULL OR NEW.checked_out_by IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Initial booking state does not match its deposit terms' USING ERRCODE = '23514';
    END IF;
    IF NEW.policy_version IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM booking_policy_audits policy
      WHERE policy.version = NEW.policy_version
        AND policy.require_full_payment_at_checkout = NEW.checkout_payment_required
        AND ((policy.deposit_percent = 0 AND NEW.deposit_required = 0)
          OR policy.deposit_percent > 0)
    ) THEN
      RAISE EXCEPTION 'Booking terms must reference their immutable policy snapshot' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.booking_id, NEW.customer_id, NEW.created_at, NEW.check_in_date, NEW.check_out_date, NEW.guest_count)
     IS DISTINCT FROM ROW(OLD.booking_id, OLD.customer_id, OLD.created_at, OLD.check_in_date, OLD.check_out_date, OLD.guest_count) THEN
    RAISE EXCEPTION 'Booking identity, stay dates and guest snapshot are immutable' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.policy_version, NEW.deposit_required, NEW.checkout_payment_required, NEW.pending_expires_at)
     IS DISTINCT FROM ROW(OLD.policy_version, OLD.deposit_required, OLD.checkout_payment_required, OLD.pending_expires_at) THEN
    RAISE EXCEPTION 'Booking policy and deposit snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = NEW.status THEN
    IF ROW(NEW.lifecycle_version, NEW.expired_at, NEW.no_show_at, NEW.no_show_by, NEW.no_show_reason,
           NEW.checked_in_at, NEW.checked_in_by, NEW.checked_out_at, NEW.checked_out_by)
       IS DISTINCT FROM ROW(OLD.lifecycle_version, OLD.expired_at, OLD.no_show_at, OLD.no_show_by, OLD.no_show_reason,
           OLD.checked_in_at, OLD.checked_in_by, OLD.checked_out_at, OLD.checked_out_by) THEN
      RAISE EXCEPTION 'Lifecycle version and audit fields change only with a status transition' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'Pending' AND NEW.status IN ('Confirmed', 'Canceled', 'Expired'))
    OR (OLD.status = 'Confirmed' AND NEW.status IN ('CheckedIn', 'Canceled', 'NoShow'))
    OR (OLD.status = 'CheckedIn' AND NEW.status = 'Completed')) THEN
    RAISE EXCEPTION 'Invalid booking lifecycle transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;

  -- Audit fields are write-once and belong to the matching transition only.
  IF (NEW.status <> 'CheckedIn' AND ROW(NEW.checked_in_at, NEW.checked_in_by)
       IS DISTINCT FROM ROW(OLD.checked_in_at, OLD.checked_in_by))
     OR (NEW.status <> 'Completed' AND ROW(NEW.checked_out_at, NEW.checked_out_by)
       IS DISTINCT FROM ROW(OLD.checked_out_at, OLD.checked_out_by))
     OR (NEW.status <> 'Expired' AND NEW.expired_at IS DISTINCT FROM OLD.expired_at)
     OR (NEW.status <> 'NoShow' AND ROW(NEW.no_show_at, NEW.no_show_by, NEW.no_show_reason)
       IS DISTINCT FROM ROW(OLD.no_show_at, OLD.no_show_by, OLD.no_show_reason)) THEN
    RAISE EXCEPTION 'Lifecycle audit fields cannot be rewritten' USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'Confirmed' THEN
    IF OLD.pending_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Pending booking has expired' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(CASE WHEN transaction_type = 'Payment' THEN amount ELSE -amount END), 0)
      INTO net_paid FROM payment_transactions WHERE booking_id = NEW.booking_id;
    IF net_paid < NEW.deposit_required THEN
      RAISE EXCEPTION 'Booking deposit has not been paid' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'Expired' THEN
    IF OLD.pending_expires_at > clock_timestamp() THEN
      RAISE EXCEPTION 'Pending hold has not expired' USING ERRCODE = '23514';
    END IF;
    NEW.expired_at := clock_timestamp();
  ELSIF NEW.status = 'NoShow' THEN
    IF NEW.no_show_by IS NULL OR NEW.no_show_reason IS NULL OR BTRIM(NEW.no_show_reason) = '' THEN
      RAISE EXCEPTION 'No-show requires an actor and reason' USING ERRCODE = '23514';
    END IF;
    IF OLD.check_in_date >= (clock_timestamp() AT TIME ZONE business_timezone)::date THEN
      RAISE EXCEPTION 'No-show requires an arrival date before today' USING ERRCODE = '23514';
    END IF;
    NEW.no_show_at := clock_timestamp();
  ELSIF NEW.status = 'CheckedIn' THEN
    IF NEW.checked_in_by IS NULL THEN
      RAISE EXCEPTION 'Check-in requires an actor' USING ERRCODE = '23514';
    END IF;
    IF NOT (OLD.check_in_date <= (clock_timestamp() AT TIME ZONE business_timezone)::date
      AND OLD.check_out_date > (clock_timestamp() AT TIME ZONE business_timezone)::date) THEN
      RAISE EXCEPTION 'Check-in requires a current scheduled stay' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(CASE WHEN transaction_type = 'Payment' THEN amount ELSE -amount END), 0)
      INTO net_paid FROM payment_transactions WHERE booking_id = NEW.booking_id;
    IF net_paid < NEW.deposit_required THEN
      RAISE EXCEPTION 'Check-in requires the agreed deposit' USING ERRCODE = '23514';
    END IF;
    NEW.checked_in_at := clock_timestamp();
  ELSIF NEW.status = 'Completed' THEN
    IF OLD.checked_in_at IS NULL OR OLD.checked_in_by IS NULL OR NEW.checked_out_by IS NULL THEN
      RAISE EXCEPTION 'Checkout requires an actual audited check-in and checkout actor' USING ERRCODE = '23514';
    END IF;
    IF NEW.checkout_payment_required THEN
      SELECT COALESCE(SUM(applied_price), 0) * (NEW.check_out_date - NEW.check_in_date)
        INTO total_due FROM booking_details WHERE booking_id = NEW.booking_id;
      SELECT COALESCE(SUM(CASE WHEN transaction_type = 'Payment' THEN amount ELSE -amount END), 0)
        INTO net_paid FROM payment_transactions WHERE booking_id = NEW.booking_id;
      SELECT COALESCE(MAX(authorized_amount), 0) INTO credit_limit
        FROM booking_credit_authorizations WHERE booking_id = NEW.booking_id;
      IF total_due - net_paid > credit_limit THEN
        RAISE EXCEPTION 'Checkout balance requires payment or sufficient credit authorization' USING ERRCODE = '23514';
      END IF;
    END IF;
    NEW.checked_out_at := clock_timestamp();
  END IF;
  NEW.lifecycle_version := OLD.lifecycle_version + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_workflow_guard_trigger ON bookings;
CREATE TRIGGER bookings_workflow_guard_trigger BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION enforce_booking_workflow();

-- Availability checks also protect direct SQL and future writers. The room
-- lock serializes competing assignments; Pending holds count only until their
-- database-clock deadline. Dates and money snapshots cannot be rewritten to
-- evade this guard after the detail has been allocated.
CREATE OR REPLACE FUNCTION enforce_booking_detail_workflow()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE booking_row bookings%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.detail_id, NEW.booking_id, NEW.applied_price, NEW.room_type_name_snapshot)
       IS DISTINCT FROM ROW(OLD.detail_id, OLD.booking_id, OLD.applied_price, OLD.room_type_name_snapshot) THEN
      RAISE EXCEPTION 'Booking detail identity and price snapshot are immutable' USING ERRCODE = '55000';
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
DROP TRIGGER IF EXISTS booking_details_workflow_guard_trigger ON booking_details;
CREATE TRIGGER booking_details_workflow_guard_trigger BEFORE INSERT OR UPDATE ON booking_details
FOR EACH ROW EXECUTE FUNCTION enforce_booking_detail_workflow();

CREATE OR REPLACE FUNCTION capture_booking_workflow_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  event_id_value UUID := uuid_generate_v4();
  previous_status VARCHAR(20);
  actor_value UUID;
  reason_value TEXT := NULLIF(current_setting('hotelai.reason', TRUE), '');
  kind_value VARCHAR(100);
  event_time TIMESTAMPTZ := clock_timestamp();
  payload_value JSONB;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;
    previous_status := OLD.status;
  END IF;
  actor_value := NULLIF(current_setting('hotelai.actor_id', TRUE), '')::uuid;
  IF NEW.status = 'NoShow' THEN actor_value := NEW.no_show_by; reason_value := NEW.no_show_reason;
  ELSIF NEW.status = 'CheckedIn' THEN actor_value := NEW.checked_in_by;
  ELSIF NEW.status = 'Completed' THEN actor_value := NEW.checked_out_by;
  END IF;
  kind_value := CASE NEW.status
    WHEN 'Pending' THEN 'booking.pending.v1' WHEN 'Confirmed' THEN 'booking.confirmed.v1'
    WHEN 'Canceled' THEN 'booking.canceled.v1' WHEN 'Expired' THEN 'booking.expired.v1'
    WHEN 'NoShow' THEN 'booking.no-show.v1' WHEN 'CheckedIn' THEN 'booking.checked-in.v1'
    WHEN 'Completed' THEN 'booking.checked-out.v1' END;
  payload_value := jsonb_build_object('event_id', event_id_value, 'booking_id', NEW.booking_id,
    'customer_id', NEW.customer_id, 'status', NEW.status, 'previous_status', previous_status,
    'lifecycle_version', NEW.lifecycle_version, 'actor_id', actor_value, 'reason', reason_value,
    'pending_expires_at', NEW.pending_expires_at, 'deposit_required', NEW.deposit_required);
  INSERT INTO booking_lifecycle_events (event_id, booking_id, from_status, to_status, version, actor_id, reason, occurred_at)
    VALUES (event_id_value, NEW.booking_id, previous_status, NEW.status, NEW.lifecycle_version, actor_value, reason_value, event_time);
  INSERT INTO customer_notifications (customer_id, booking_id, event_id, kind, payload, created_at)
    VALUES (NEW.customer_id, NEW.booking_id, event_id_value, kind_value, payload_value, event_time);
  -- Existing created/canceled/check-in/checkout events remain application-owned.
  IF TG_OP = 'UPDATE' AND (NEW.status IN ('Expired', 'NoShow')
      OR (previous_status = 'Pending' AND NEW.status = 'Confirmed')) THEN
    INSERT INTO event_outbox (event_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
      VALUES (event_id_value, 'booking', NEW.booking_id::text, kind_value, payload_value, event_time);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_workflow_event_trigger ON bookings;
CREATE TRIGGER bookings_workflow_event_trigger AFTER INSERT OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION capture_booking_workflow_event();

CREATE OR REPLACE FUNCTION enforce_booking_payment_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  booking_row bookings%ROWTYPE;
  parent_row payment_transactions%ROWTYPE;
  total_due NUMERIC;
  net_paid NUMERIC;
  already_refunded NUMERIC;
BEGIN
  -- Lock the aggregate first for both payments and refunds. This serializes
  -- money with expiry/checkout and avoids a parent-payment/booking lock inversion.
  SELECT * INTO booking_row FROM bookings WHERE booking_id = NEW.booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown booking' USING ERRCODE = '23503'; END IF;
  IF NEW.transaction_type = 'Payment' THEN
    IF booking_row.status IN ('Canceled', 'Expired', 'NoShow')
       OR (booking_row.status = 'Pending' AND booking_row.pending_expires_at <= clock_timestamp()) THEN
      RAISE EXCEPTION 'Booking cannot accept payment in its current state' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(applied_price), 0) * (booking_row.check_out_date - booking_row.check_in_date)
      INTO total_due FROM booking_details WHERE booking_id = NEW.booking_id;
    SELECT COALESCE(SUM(CASE WHEN transaction_type = 'Payment' THEN amount ELSE -amount END), 0)
      INTO net_paid FROM payment_transactions WHERE booking_id = NEW.booking_id;
    IF net_paid + NEW.amount > total_due THEN
      RAISE EXCEPTION 'Payment exceeds the booking balance' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.transaction_type = 'Refund' THEN
    IF booking_row.status NOT IN ('Canceled', 'Expired', 'NoShow') THEN
      RAISE EXCEPTION 'Refund requires a canceled, expired or no-show booking' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO parent_row FROM payment_transactions WHERE payment_id = NEW.parent_payment_id;
    IF NOT FOUND OR parent_row.booking_id <> NEW.booking_id OR parent_row.transaction_type <> 'Payment' THEN
      RAISE EXCEPTION 'Refund must reference a payment for the same booking' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO already_refunded FROM payment_transactions
      WHERE parent_payment_id = NEW.parent_payment_id AND transaction_type = 'Refund';
    IF already_refunded + NEW.amount > parent_row.amount THEN
      RAISE EXCEPTION 'Refund exceeds the original payment balance' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payment_transactions_workflow_guard_trigger ON payment_transactions;
CREATE TRIGGER payment_transactions_workflow_guard_trigger BEFORE INSERT ON payment_transactions
FOR EACH ROW EXECUTE FUNCTION enforce_booking_payment_insert();

CREATE OR REPLACE FUNCTION confirm_booking_after_deposit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  previous_actor TEXT := current_setting('hotelai.actor_id', TRUE);
  previous_reason TEXT := current_setting('hotelai.reason', TRUE);
BEGIN
  IF NEW.transaction_type = 'Payment' THEN
    -- Do not silently keep a payment if its hold expires between the BEFORE
    -- check and this AFTER trigger. A failed confirmation rolls back the same
    -- ledger INSERT, including concurrent/multi-row deposits at the cutoff.
    IF EXISTS (SELECT 1 FROM bookings WHERE booking_id = NEW.booking_id
        AND status = 'Pending' AND pending_expires_at <= clock_timestamp()) THEN
      RAISE EXCEPTION 'Pending booking expired while recording payment' USING ERRCODE = '23514';
    END IF;
    PERFORM set_config('hotelai.actor_id', NEW.created_by::text, TRUE);
    PERFORM set_config('hotelai.reason', 'Required deposit received', TRUE);
    UPDATE bookings booking SET status = 'Confirmed'
      WHERE booking.booking_id = NEW.booking_id AND booking.status = 'Pending'
        AND booking.deposit_required <= (
          SELECT COALESCE(SUM(CASE WHEN transaction_type = 'Payment' THEN amount ELSE -amount END), 0)
          FROM payment_transactions WHERE booking_id = NEW.booking_id
        );
    PERFORM set_config('hotelai.actor_id', COALESCE(previous_actor, ''), TRUE);
    PERFORM set_config('hotelai.reason', COALESCE(previous_reason, ''), TRUE);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payment_transactions_deposit_trigger ON payment_transactions;
CREATE TRIGGER payment_transactions_deposit_trigger AFTER INSERT ON payment_transactions
FOR EACH ROW EXECUTE FUNCTION confirm_booking_after_deposit();

CREATE OR REPLACE FUNCTION enforce_booking_credit_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE booking_row bookings%ROWTYPE; total_due NUMERIC; net_paid NUMERIC;
BEGIN
  SELECT * INTO booking_row FROM bookings WHERE booking_id = NEW.booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown booking' USING ERRCODE = '23503'; END IF;
  IF booking_row.status <> 'CheckedIn' THEN
    RAISE EXCEPTION 'Credit can only be authorized for an active stay' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM(applied_price), 0) * (booking_row.check_out_date - booking_row.check_in_date)
    INTO total_due FROM booking_details WHERE booking_id = NEW.booking_id;
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'Payment' THEN amount ELSE -amount END), 0)
    INTO net_paid FROM payment_transactions WHERE booking_id = NEW.booking_id;
  IF NEW.authorized_amount > total_due - net_paid THEN
    RAISE EXCEPTION 'Credit cannot exceed the outstanding booking balance' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS booking_credit_authorizations_guard_trigger ON booking_credit_authorizations;
CREATE TRIGGER booking_credit_authorizations_guard_trigger BEFORE INSERT ON booking_credit_authorizations
FOR EACH ROW EXECUTE FUNCTION enforce_booking_credit_insert();

CREATE OR REPLACE FUNCTION enqueue_booking_credit_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO event_outbox (aggregate_type, aggregate_id, event_type, payload, occurred_at)
    VALUES ('booking', NEW.booking_id::text, 'booking.credit-authorized.v1',
      jsonb_build_object('booking_id', NEW.booking_id, 'authorization_id', NEW.authorization_id,
        'authorized_amount', NEW.authorized_amount, 'authorized_by', NEW.authorized_by, 'reason', NEW.reason), NEW.created_at);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS booking_credit_authorizations_outbox_trigger ON booking_credit_authorizations;
CREATE TRIGGER booking_credit_authorizations_outbox_trigger AFTER INSERT ON booking_credit_authorizations
FOR EACH ROW EXECUTE FUNCTION enqueue_booking_credit_event();

-- UPDATE protection intentionally permits fixture/retention DELETE and FK
-- cascade cleanup. No blanket DELETE guard is added to any existing ledger.
CREATE OR REPLACE FUNCTION prevent_booking_workflow_audit_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; UPDATE is not allowed', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['booking_policy_audits', 'booking_credit_authorizations',
    'booking_workflow_requests', 'booking_lifecycle_events', 'payment_transactions'] LOOP
    EXECUTE FORMAT('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_immutable_update_trigger', table_name);
    EXECUTE FORMAT('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_booking_workflow_audit_update()',
      table_name || '_immutable_update_trigger', table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION enforce_customer_notification_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at') THEN
    RAISE EXCEPTION 'Notification content is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'Notification read timestamp is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.read_at IS NULL AND NEW.read_at IS NOT NULL THEN NEW.read_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS customer_notifications_immutable_update_trigger ON customer_notifications;
CREATE TRIGGER customer_notifications_immutable_update_trigger BEFORE UPDATE ON customer_notifications
FOR EACH ROW EXECUTE FUNCTION enforce_customer_notification_update();

ALTER TABLE pricing_quote_events DROP CONSTRAINT IF EXISTS pricing_quote_events_type_check;
ALTER TABLE pricing_quote_events ADD CONSTRAINT pricing_quote_events_type_check CHECK (event_type IN (
  'quote.generated.v1', 'quote.exposed.v1', 'quote.rejected.v1', 'quote.accepted.v1',
  'booking.canceled.v1', 'booking.expired.v1', 'booking.no-show.v1', 'stay.completed.v1'
));

CREATE OR REPLACE FUNCTION capture_pricing_quote_booking_outcome()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE quote_event_type VARCHAR(50); quote_event_time TIMESTAMPTZ;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  CASE NEW.status
    WHEN 'Canceled' THEN quote_event_type := 'booking.canceled.v1'; quote_event_time := clock_timestamp();
    WHEN 'Expired' THEN quote_event_type := 'booking.expired.v1'; quote_event_time := NEW.expired_at;
    WHEN 'NoShow' THEN quote_event_type := 'booking.no-show.v1'; quote_event_time := NEW.no_show_at;
    WHEN 'Completed' THEN quote_event_type := 'stay.completed.v1'; quote_event_time := NEW.checked_out_at;
    ELSE RETURN NEW;
  END CASE;
  INSERT INTO pricing_quote_events (quote_id, event_type, occurred_at, source, metadata)
    SELECT quote.quote_id, quote_event_type, quote_event_time, 'database_trigger',
      jsonb_build_object('booking_id', NEW.booking_id, 'previous_status', OLD.status, 'new_status', NEW.status)
    FROM pricing_quotes quote WHERE quote.booking_id = NEW.booking_id
    ON CONFLICT (quote_id, event_type) DO NOTHING;
  RETURN NEW;
END;
$$;

-- View definition follows below; its original column names/order/types stay stable.
CREATE OR REPLACE VIEW pricing_quote_training_dataset_v1 AS
WITH event_rollup AS (
  SELECT event.quote_id,
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'quote.generated.v1'
         ) AS generated_event_at,
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'quote.exposed.v1'
         ) AS explicit_exposed_at,
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'quote.rejected.v1'
         ) AS rejected_at,
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'quote.accepted.v1'
         ) AS accepted_event_at,
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'booking.canceled.v1'
         ) AS booking_canceled_at,
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'stay.completed.v1'
         ) AS stay_completed_at,
         (MIN(event.session_id::text) FILTER (
           WHERE event.event_type = 'quote.exposed.v1'
         ))::uuid AS exposure_session_id,
         (MIN(event.search_id::text) FILTER (
           WHERE event.event_type = 'quote.exposed.v1'
         ))::uuid AS exposure_search_id,
         COUNT(*)::int AS quote_event_count
  FROM pricing_quote_events event
  GROUP BY event.quote_id
),
payment_rollup AS (
  SELECT payment.booking_id,
         COALESCE(SUM(payment.amount) FILTER (
           WHERE payment.transaction_type = 'Payment'
         ), 0) AS paid_amount,
         COALESCE(SUM(payment.amount) FILTER (
           WHERE payment.transaction_type = 'Refund'
         ), 0) AS refunded_amount
  FROM payment_transactions payment
  GROUP BY payment.booking_id
),
facts AS (
  SELECT quote.*,
         booking.status AS booking_status,
         booking.checked_in_at,
         booking.checked_out_at,
         booking.expired_at,
         booking.no_show_at,
         event.generated_event_at,
         event.explicit_exposed_at,
         event.rejected_at,
         COALESCE(quote.accepted_at, event.accepted_event_at) AS resolved_accepted_at,
         event.booking_canceled_at,
         CASE WHEN booking.checked_in_at IS NOT NULL AND booking.checked_in_by IS NOT NULL
                AND booking.checked_out_at IS NOT NULL AND booking.checked_out_by IS NOT NULL
              THEN booking.checked_out_at ELSE NULL END AS resolved_completed_at,
         event.exposure_session_id,
         event.exposure_search_id,
         COALESCE(event.quote_event_count, 0) AS quote_event_count,
         COALESCE(payment.paid_amount, 0) AS paid_amount,
         COALESCE(payment.refunded_amount, 0) AS refunded_amount
  FROM pricing_quotes quote
  LEFT JOIN bookings booking ON booking.booking_id = quote.booking_id
  LEFT JOIN event_rollup event ON event.quote_id = quote.quote_id
  LEFT JOIN payment_rollup payment ON payment.booking_id = quote.booking_id
)
SELECT facts.quote_id,
       facts.customer_id,
       facts.booking_id,
       facts.room_type_id,
       facts.room_type_name_snapshot,
       facts.capacity_snapshot,
       facts.check_in_date,
       facts.check_out_date,
       (facts.check_out_date - facts.check_in_date)::int AS stay_length_nights,
       facts.guest_count,
       facts.total_of_special_requests,
       facts.lead_time,
       facts.is_weekend,
       facts.rooms_available,
       facts.rooms_sellable_snapshot,
       facts.rooms_booked_snapshot,
       facts.occupancy_ratio_snapshot,
       facts.inventory_snapshot_at,
       CASE
         WHEN facts.rooms_sellable_snapshot IS NULL THEN NULL
         ELSE facts.rooms_available <= facts.rooms_sellable_snapshot
           AND facts.rooms_booked_snapshot BETWEEN 0 AND facts.rooms_sellable_snapshot
           AND facts.rooms_available + facts.rooms_booked_snapshot
             = facts.rooms_sellable_snapshot
           AND ABS(
             facts.occupancy_ratio_snapshot
               - CASE
                   WHEN facts.rooms_sellable_snapshot = 0 THEN 0
                   ELSE facts.rooms_booked_snapshot::numeric
                     / facts.rooms_sellable_snapshot
                 END
           ) <= 0.000001
       END AS inventory_snapshot_consistent,
       facts.base_price,
       facts.ai_multiplier,
       facts.nightly_price,
       facts.total_price,
       facts.currency,
       facts.pricing_source,
       facts.settings_version,
       facts.ai_model_version,
       facts.ai_training_run_id,
       facts.ai_feature_contract_version,
       facts.created_at AS generated_at,
       facts.explicit_exposed_at,
       COALESCE(
         facts.explicit_exposed_at,
         facts.generated_event_at,
         facts.created_at
       ) AS exposure_at,
       (facts.explicit_exposed_at IS NOT NULL) AS exposure_confirmed,
       (facts.explicit_exposed_at IS NULL) AS exposure_is_generated_proxy,
       facts.exposure_session_id,
       facts.exposure_search_id,
       facts.expires_at,
       facts.resolved_accepted_at AS accepted_at,
       facts.rejected_at,
       facts.booking_canceled_at,
       facts.resolved_completed_at AS stay_completed_at,
       facts.booking_status,
       CASE
         WHEN facts.booking_status = 'Completed' AND facts.resolved_completed_at IS NOT NULL THEN 'completed'
         WHEN facts.booking_status = 'Completed' THEN 'legacy_unverified'
         WHEN facts.booking_status = 'NoShow' THEN 'no_show'
         WHEN facts.booking_status = 'Expired' THEN 'booking_expired'
         WHEN facts.booking_status = 'Pending' THEN 'pending'
         WHEN facts.booking_status = 'Canceled' THEN 'canceled'
         WHEN facts.booking_id IS NOT NULL THEN 'accepted'
         WHEN facts.rejected_at IS NOT NULL THEN 'rejected'
         WHEN CURRENT_TIMESTAMP >= facts.expires_at THEN 'expired'
         ELSE 'open'
       END AS latest_outcome,
       CASE
         WHEN facts.booking_id IS NOT NULL THEN 'accepted'
         WHEN facts.rejected_at IS NOT NULL THEN 'rejected'
         WHEN CURRENT_TIMESTAMP >= facts.expires_at THEN 'expired'
         ELSE 'open'
       END AS quote_disposition,
       CASE
         WHEN facts.booking_id IS NOT NULL THEN TRUE
         WHEN facts.rejected_at IS NOT NULL THEN FALSE
         WHEN CURRENT_TIMESTAMP >= facts.expires_at THEN FALSE
         ELSE NULL
       END AS acceptance_label,
       CASE
         WHEN facts.booking_id IS NULL THEN NULL
         WHEN facts.booking_status = 'Canceled' THEN TRUE
         WHEN facts.booking_status IN ('Completed', 'Expired', 'NoShow') THEN FALSE
         ELSE NULL
       END AS cancellation_label,
       CASE
         WHEN facts.booking_id IS NULL THEN NULL
         WHEN facts.booking_status = 'Completed' AND facts.resolved_completed_at IS NOT NULL THEN TRUE
         WHEN facts.booking_status IN ('Canceled', 'Expired', 'NoShow') THEN FALSE
         ELSE NULL
       END AS completed_stay_label,
       CASE
         WHEN facts.booking_id IS NOT NULL THEN facts.resolved_accepted_at
         WHEN facts.rejected_at IS NOT NULL THEN facts.rejected_at
         WHEN CURRENT_TIMESTAMP >= facts.expires_at THEN facts.expires_at
         ELSE NULL
       END AS acceptance_label_available_at,
       CASE
         WHEN facts.booking_status = 'Canceled' THEN facts.booking_canceled_at
         WHEN facts.booking_status = 'Completed' THEN facts.resolved_completed_at
         WHEN facts.booking_status = 'Expired' THEN facts.expired_at
         WHEN facts.booking_status = 'NoShow' THEN facts.no_show_at
         ELSE NULL
       END AS stay_label_available_at,
       (
         facts.booking_id IS NOT NULL
         AND facts.rejected_at IS NOT NULL
       ) AS has_disposition_conflict,
       facts.paid_amount,
       facts.refunded_amount,
       (facts.paid_amount - facts.refunded_amount) AS net_paid_amount,
       CASE
         WHEN facts.booking_id IS NULL THEN NULL
         ELSE (facts.paid_amount - facts.refunded_amount) >= facts.total_price
       END AS is_fully_paid,
       facts.quote_event_count,
       CURRENT_TIMESTAMP AS dataset_evaluated_at
FROM facts;

COMMENT ON TABLE pricing_quote_events IS
  'Append-only quote funnel and post-booking outcome events for AI feedback.';
COMMENT ON VIEW pricing_quote_training_dataset_v1 IS
  'Censor-aware quote conversion/stay facts. Pending is accepted intent, not a completed stay; Expired/NoShow are distinct negative stay outcomes. Legacy completion without audited check-in/out is censored.';

COMMIT;
