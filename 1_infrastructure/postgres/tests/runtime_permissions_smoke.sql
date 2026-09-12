\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE hotelai_runtime;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'bookings', 'SELECT') THEN RAISE EXCEPTION 'Missing booking read privilege'; END IF;
  IF has_table_privilege(current_user, 'bookings', 'DELETE')
    OR has_table_privilege(current_user, 'payment_transactions', 'DELETE')
    OR has_table_privilege(current_user, 'schema_migrations', 'INSERT')
    OR has_table_privilege(current_user, 'booking_lifecycle_events', 'UPDATE')
    OR has_table_privilege(current_user, 'pricing_quote_events', 'TRUNCATE')
    OR has_column_privilege(current_user, 'event_outbox', 'payload', 'UPDATE')
    OR has_schema_privilege(current_user, 'public', 'CREATE')
    THEN RAISE EXCEPTION 'Runtime role has privileged destructive rights'; END IF;
  BEGIN
    PERFORM set_config('hotelai.allow_quote_event_cleanup', 'on', true);
    DELETE FROM pricing_quote_events WHERE false;
    RAISE EXCEPTION 'Cleanup setting bypassed runtime privileges';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    ALTER TABLE bookings DISABLE TRIGGER ALL;
    RAISE EXCEPTION 'Runtime role can disable integrity triggers';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
