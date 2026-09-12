-- Separate the application permission group from the migration/table owner.
-- Provision an environment-specific LOGIN separately, then GRANT hotelai_runtime.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotelai_runtime') THEN
    CREATE ROLE hotelai_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotelai_runtime'
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'hotelai_runtime must be an unprivileged NOLOGIN permission group';
  END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hotelai_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hotelai_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hotelai_runtime;

-- Explicit allowlist: future tables do not silently acquire write permission.
GRANT INSERT ON customers, customer_account_audits, room_types, rooms, bookings,
  booking_details, booking_create_requests, daily_pricing_logs, payment_transactions,
  pricing_quotes, pricing_quote_events, pricing_setting_audits, event_outbox,
  ai_pricing_shadow_setting_audits, ai_pricing_shadow_attempts, ai_pricing_shadow_decisions,
  room_housekeeping_events, booking_room_assignment_events, booking_policy_audits,
  booking_credit_authorizations, booking_workflow_requests, booking_lifecycle_events,
  customer_notifications TO hotelai_runtime;
GRANT UPDATE ON customers, room_types, rooms, bookings, booking_details,
  pricing_quotes, pricing_settings, ai_pricing_shadow_settings, booking_policies TO hotelai_runtime;
GRANT UPDATE (attempts, published_at, last_error, next_attempt_at) ON event_outbox TO hotelai_runtime;
GRANT UPDATE (read_at) ON customer_notifications TO hotelai_runtime;
-- PostgreSQL requires UPDATE permission for a row lock. The immutable trigger
-- still rejects any attempted UPDATE of a payment, including this column.
GRANT UPDATE (payment_id) ON payment_transactions TO hotelai_runtime;
GRANT DELETE ON rooms, room_types TO hotelai_runtime;

-- Outbox delivery may change delivery metadata, never historical event data.
CREATE OR REPLACE FUNCTION enforce_outbox_event_identity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.event_id, NEW.aggregate_type, NEW.aggregate_id, NEW.event_type, NEW.payload, NEW.occurred_at)
    IS DISTINCT FROM ROW(OLD.event_id, OLD.aggregate_type, OLD.aggregate_id, OLD.event_type, OLD.payload, OLD.occurred_at) THEN
    RAISE EXCEPTION 'Outbox event identity and payload are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_outbox_identity_guard BEFORE UPDATE ON event_outbox
FOR EACH ROW EXECUTE FUNCTION enforce_outbox_event_identity();
COMMIT;
