\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  actor_id UUID := uuid_generate_v4();
  test_room_type_id INT;
  test_quote_id UUID;
  test_attempt_id UUID;
  conflict_quote_id UUID;
  conflict_attempt_id UUID;
  out_of_window_quote_id UUID;
  conflict_version INT;
  enabled_version INT;
  guarded_multiplier NUMERIC;
  decision_status TEXT;
  decision_latency INT;
  current_status TEXT;
  current_is_current BOOLEAN;
  out_of_window_attempts INT;
  setting_timestamp TIMESTAMPTZ;
BEGIN
  INSERT INTO customers (customer_id, full_name, email, password_hash, role)
  VALUES (
    actor_id,
    'AI Shadow Migration Test',
    'ai-shadow-migration-test@example.invalid',
    'not-a-login-credential',
    'admin'
  );

  INSERT INTO room_types (name, base_price, capacity)
  VALUES ('AI Shadow Test Room', 100, 2)
  RETURNING type_id INTO test_room_type_id;

  INSERT INTO rooms (room_number, type_id, current_status)
  VALUES ('AI-SH-01', test_room_type_id, 'Available');

  PERFORM set_config(
    'hotelai.ai_shadow_change_reason',
    'Enable deterministic AI shadow migration smoke test',
    TRUE
  );
  UPDATE ai_pricing_shadow_settings
  SET shadow_enabled = TRUE,
      champion_model_version = 'pricing-champion-test',
      champion_training_run_id = 'pricing-champion-run-test',
      champion_feature_contract_version = '2.0.0',
      challenger_model_version = 'conversion-challenger-test',
      challenger_training_run_id = 'conversion-challenger-run-test',
      challenger_feature_contract_version = '1.0.0',
      guardrail_min_multiplier = 0.5,
      guardrail_max_multiplier = 3,
      guardrail_max_change_ratio = 0.1,
      minimum_confirmed_exposures = 2,
      minimum_conversions = 1,
      minimum_non_conversions = 1,
      minimum_shadow_days = 1,
      minimum_inference_coverage_ratio = 0.99,
      maximum_inference_error_ratio = 0.01,
      version = version + 1,
      updated_at = TIMESTAMPTZ '2000-01-01 00:00:00+00',
      updated_by = actor_id
  WHERE setting_id = 1
  RETURNING version, updated_at INTO enabled_version, setting_timestamp;

  IF setting_timestamp < CURRENT_TIMESTAMP - INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'Database did not own the policy update timestamp';
  END IF;

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
    created_at,
    expires_at
  ) VALUES (
    test_room_type_id,
    'AI Shadow Test Room',
    2,
    CURRENT_DATE + 10,
    CURRENT_DATE + 12,
    2,
    0,
    10,
    FALSE,
    1,
    100,
    1.2,
    120,
    240,
    'ai',
    1,
    'pricing-champion-test',
    'pricing-champion-run-test',
    '2.0.0',
    clock_timestamp(),
    clock_timestamp() + INTERVAL '15 minutes'
  ) RETURNING quote_id INTO test_quote_id;

  INSERT INTO pricing_quote_events (
    quote_id,
    event_type,
    occurred_at,
    source,
    session_id,
    search_id,
    idempotency_key
  ) VALUES (
    test_quote_id,
    'quote.exposed.v1',
    CURRENT_TIMESTAMP,
    'migration_test',
    uuid_generate_v4(),
    uuid_generate_v4(),
    'shadow-smoke-exposed'
  );
  INSERT INTO pricing_quote_events (
    quote_id,
    event_type,
    occurred_at,
    source,
    idempotency_key
  ) VALUES (
    test_quote_id,
    'quote.rejected.v1',
    CURRENT_TIMESTAMP,
    'migration_test',
    'shadow-smoke-rejected'
  );

  INSERT INTO ai_pricing_shadow_attempts (
    quote_id,
    control_version,
    outcome,
    inference_latency_ms,
    idempotency_key
  ) VALUES (
    test_quote_id,
    enabled_version,
    'succeeded',
    123,
    'shadow-smoke-attempt'
  ) RETURNING attempt_id INTO test_attempt_id;

  INSERT INTO ai_pricing_shadow_decisions (
    attempt_id,
    quote_id,
    control_version,
    champion_model_version,
    champion_training_run_id,
    champion_feature_contract_version,
    champion_multiplier,
    challenger_model_version,
    challenger_training_run_id,
    challenger_feature_contract_version,
    predicted_conversion_probability,
    proposed_multiplier,
    guardrail_status,
    inference_latency_ms,
    source,
    idempotency_key
  ) VALUES (
    test_attempt_id,
    test_quote_id,
    enabled_version,
    'ignored-and-overwritten',
    'ignored-and-overwritten',
    'ignored-and-overwritten',
    1,
    'conversion-challenger-test',
    'conversion-challenger-run-test',
    '1.0.0',
    0.55,
    2,
    'within_policy',
    999,
    'migration_test',
    'shadow-smoke-decision'
  ) RETURNING guardrailed_multiplier, guardrail_status, inference_latency_ms
    INTO guarded_multiplier, decision_status, decision_latency;

  IF guarded_multiplier <> 1.32 OR decision_status <> 'adjusted' THEN
    RAISE EXCEPTION 'Relative-to-champion guardrail was not applied: %, %',
      guarded_multiplier, decision_status;
  END IF;
  IF decision_latency <> 123 THEN
    RAISE EXCEPTION 'Decision latency did not inherit the successful attempt';
  END IF;

  SELECT readiness_status, is_current_control
  INTO current_status, current_is_current
  FROM ai_pricing_shadow_readiness_v1
  WHERE control_version = enabled_version;
  IF current_status <> 'insufficient_confirmed_exposures'
     OR current_is_current IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Unexpected readiness result: %, %', current_status, current_is_current;
  END IF;

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
    created_at,
    expires_at
  )
  SELECT room_type_id,
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
         setting_timestamp - INTERVAL '1 second',
         setting_timestamp + INTERVAL '15 minutes'
  FROM pricing_quotes
  WHERE quote_id = test_quote_id
  RETURNING quote_id INTO out_of_window_quote_id;

  INSERT INTO ai_pricing_shadow_attempts (
    quote_id, control_version, outcome, inference_latency_ms, error_code,
    idempotency_key
  ) VALUES (
    out_of_window_quote_id, enabled_version, 'error', 1,
    'out_of_window_test', 'shadow-out-of-window-attempt'
  );

  SELECT readiness.readiness_status, readiness.out_of_window_attempts
  INTO current_status, out_of_window_attempts
  FROM ai_pricing_shadow_readiness_v1 readiness
  WHERE readiness.control_version = enabled_version;
  IF current_status <> 'out_of_window_attempts' OR out_of_window_attempts <> 1 THEN
    RAISE EXCEPTION 'Out-of-window attempt was not reported/gated: %, %',
      current_status, out_of_window_attempts;
  END IF;

  BEGIN
    UPDATE ai_pricing_shadow_decisions
    SET source = 'illegal-mutation'
    WHERE quote_id = test_quote_id;
    RAISE EXCEPTION 'Append-only shadow decision accepted an update';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    DELETE FROM ai_pricing_shadow_settings WHERE setting_id = 1;
    RAISE EXCEPTION 'Singleton shadow setting accepted deletion';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  PERFORM set_config(
    'hotelai.ai_shadow_change_reason',
    'Exercise empty guardrail interval without losing telemetry',
    TRUE
  );
  UPDATE ai_pricing_shadow_settings
  SET guardrail_min_multiplier = 2,
      guardrail_max_multiplier = 3,
      guardrail_max_change_ratio = 0.1,
      version = version + 1,
      updated_by = actor_id
  WHERE setting_id = 1
  RETURNING version INTO conflict_version;

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
    created_at,
    expires_at
  ) VALUES (
    test_room_type_id,
    'AI Shadow Test Room',
    2,
    CURRENT_DATE + 20,
    CURRENT_DATE + 22,
    2,
    0,
    20,
    FALSE,
    1,
    100,
    1.2,
    120,
    240,
    'ai',
    1,
    'pricing-champion-test',
    'pricing-champion-run-test',
    '2.0.0',
    clock_timestamp(),
    clock_timestamp() + INTERVAL '15 minutes'
  ) RETURNING quote_id INTO conflict_quote_id;

  INSERT INTO ai_pricing_shadow_attempts (
    quote_id, control_version, outcome, inference_latency_ms, idempotency_key
  ) VALUES (
    conflict_quote_id, conflict_version, 'succeeded', 15, 'shadow-conflict-attempt'
  ) RETURNING attempt_id INTO conflict_attempt_id;

  INSERT INTO ai_pricing_shadow_decisions (
    attempt_id,
    quote_id,
    control_version,
    champion_model_version,
    champion_training_run_id,
    champion_feature_contract_version,
    champion_multiplier,
    challenger_model_version,
    challenger_training_run_id,
    challenger_feature_contract_version,
    predicted_conversion_probability,
    proposed_multiplier,
    guardrail_status,
    source,
    idempotency_key
  ) VALUES (
    conflict_attempt_id,
    conflict_quote_id,
    conflict_version,
    'ignored',
    'ignored',
    'ignored',
    1,
    'conversion-challenger-test',
    'conversion-challenger-run-test',
    '1.0.0',
    0.5,
    2.5,
    'within_policy',
    'migration_test',
    'shadow-conflict-decision'
  ) RETURNING guardrailed_multiplier, guardrail_status
    INTO guarded_multiplier, decision_status;

  IF guarded_multiplier <> 1.2 OR decision_status <> 'policy_conflict' THEN
    RAISE EXCEPTION 'Empty guardrail interval discarded safe champion fallback';
  END IF;

  PERFORM set_config(
    'hotelai.ai_shadow_change_reason',
    'Pause shadow evaluation after deterministic smoke test',
    TRUE
  );
  UPDATE ai_pricing_shadow_settings
  SET shadow_enabled = FALSE,
      version = version + 1,
      updated_by = actor_id
  WHERE setting_id = 1;

  SELECT readiness_status, is_current_control
  INTO current_status, current_is_current
  FROM ai_pricing_shadow_readiness_v1
  WHERE is_current_control;
  IF current_status <> 'paused' OR current_is_current IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Pause did not become current readiness state';
  END IF;
END;
$$;

ROLLBACK;
