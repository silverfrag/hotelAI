-- AI-004/AI-005 control-plane foundation.
--
-- This migration intentionally does not provide an automatic model-promotion
-- path. The current production endpoint remains the only price-serving path;
-- challenger observations are append-only and guardrails are evaluated only
-- as shadow telemetry until an explicit, separately reviewed deployment.

CREATE TABLE IF NOT EXISTS ai_pricing_shadow_settings (
  setting_id SMALLINT PRIMARY KEY,
  shadow_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  champion_model_version VARCHAR(100),
  champion_training_run_id VARCHAR(100),
  champion_feature_contract_version VARCHAR(50),
  challenger_model_version VARCHAR(100),
  challenger_training_run_id VARCHAR(100),
  challenger_feature_contract_version VARCHAR(50),
  guardrail_min_multiplier NUMERIC(8, 6) NOT NULL DEFAULT 0.5,
  guardrail_max_multiplier NUMERIC(8, 6) NOT NULL DEFAULT 3,
  guardrail_max_change_ratio NUMERIC(8, 6) NOT NULL DEFAULT 0.2,
  minimum_confirmed_exposures INT NOT NULL DEFAULT 2000,
  minimum_conversions INT NOT NULL DEFAULT 200,
  minimum_non_conversions INT NOT NULL DEFAULT 200,
  minimum_shadow_days INT NOT NULL DEFAULT 14,
  minimum_inference_coverage_ratio NUMERIC(8, 6) NOT NULL DEFAULT 0.99,
  maximum_inference_error_ratio NUMERIC(8, 6) NOT NULL DEFAULT 0.01,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by UUID,
  CONSTRAINT ai_pricing_shadow_settings_singleton_check CHECK (setting_id = 1),
  CONSTRAINT ai_pricing_shadow_settings_version_check CHECK (version >= 1),
  CONSTRAINT ai_pricing_shadow_settings_guardrail_check CHECK (
    guardrail_min_multiplier BETWEEN 0.1 AND 3
    AND guardrail_max_multiplier BETWEEN 0.1 AND 5
    AND guardrail_min_multiplier <= guardrail_max_multiplier
    AND guardrail_max_change_ratio BETWEEN 0 AND 1
  ),
  CONSTRAINT ai_pricing_shadow_settings_sample_check CHECK (
    minimum_confirmed_exposures BETWEEN 1 AND 100000000
    AND minimum_conversions BETWEEN 1 AND minimum_confirmed_exposures
    AND minimum_non_conversions BETWEEN 1 AND minimum_confirmed_exposures
    AND minimum_conversions + minimum_non_conversions
      <= minimum_confirmed_exposures
    AND minimum_shadow_days BETWEEN 1 AND 3650
    AND minimum_inference_coverage_ratio BETWEEN 0 AND 1
    AND maximum_inference_error_ratio BETWEEN 0 AND 1
  ),
  CONSTRAINT ai_pricing_shadow_settings_champion_identity_check CHECK (
    (champion_model_version IS NULL
      AND champion_training_run_id IS NULL
      AND champion_feature_contract_version IS NULL)
    OR
    (NULLIF(BTRIM(champion_model_version), '') IS NOT NULL
      AND NULLIF(BTRIM(champion_training_run_id), '') IS NOT NULL
      AND NULLIF(BTRIM(champion_feature_contract_version), '') IS NOT NULL)
  ),
  CONSTRAINT ai_pricing_shadow_settings_challenger_identity_check CHECK (
    (challenger_model_version IS NULL
      AND challenger_training_run_id IS NULL
      AND challenger_feature_contract_version IS NULL)
    OR
    (NULLIF(BTRIM(challenger_model_version), '') IS NOT NULL
      AND NULLIF(BTRIM(challenger_training_run_id), '') IS NOT NULL
      AND NULLIF(BTRIM(challenger_feature_contract_version), '') IS NOT NULL)
  ),
  CONSTRAINT ai_pricing_shadow_settings_enablement_check CHECK (
    NOT shadow_enabled
    OR (
      champion_model_version IS NOT NULL
      AND challenger_model_version IS NOT NULL
    )
  ),
  CONSTRAINT ai_pricing_shadow_settings_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES customers(customer_id) ON DELETE RESTRICT
);

INSERT INTO ai_pricing_shadow_settings (setting_id)
VALUES (1)
ON CONFLICT (setting_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_pricing_shadow_setting_audits (
  audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_id SMALLINT NOT NULL,
  shadow_enabled BOOLEAN NOT NULL,
  champion_model_version VARCHAR(100),
  champion_training_run_id VARCHAR(100),
  champion_feature_contract_version VARCHAR(50),
  challenger_model_version VARCHAR(100),
  challenger_training_run_id VARCHAR(100),
  challenger_feature_contract_version VARCHAR(50),
  guardrail_min_multiplier NUMERIC(8, 6) NOT NULL,
  guardrail_max_multiplier NUMERIC(8, 6) NOT NULL,
  guardrail_max_change_ratio NUMERIC(8, 6) NOT NULL,
  minimum_confirmed_exposures INT NOT NULL,
  minimum_conversions INT NOT NULL,
  minimum_non_conversions INT NOT NULL,
  minimum_shadow_days INT NOT NULL,
  minimum_inference_coverage_ratio NUMERIC(8, 6) NOT NULL,
  maximum_inference_error_ratio NUMERIC(8, 6) NOT NULL,
  version INT NOT NULL UNIQUE,
  change_reason VARCHAR(500) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  changed_by UUID,
  CONSTRAINT ai_pricing_shadow_setting_audits_setting_check CHECK (setting_id = 1),
  CONSTRAINT ai_pricing_shadow_setting_audits_reason_check
    CHECK (CHAR_LENGTH(BTRIM(change_reason)) BETWEEN 10 AND 500),
  CONSTRAINT ai_pricing_shadow_setting_audits_changed_by_fk
    FOREIGN KEY (changed_by) REFERENCES customers(customer_id) ON DELETE RESTRICT
);

INSERT INTO ai_pricing_shadow_setting_audits (
  setting_id,
  shadow_enabled,
  champion_model_version,
  champion_training_run_id,
  champion_feature_contract_version,
  challenger_model_version,
  challenger_training_run_id,
  challenger_feature_contract_version,
  guardrail_min_multiplier,
  guardrail_max_multiplier,
  guardrail_max_change_ratio,
  minimum_confirmed_exposures,
  minimum_conversions,
  minimum_non_conversions,
  minimum_shadow_days,
  minimum_inference_coverage_ratio,
  maximum_inference_error_ratio,
  version,
  change_reason,
  changed_at,
  changed_by
)
SELECT setting_id,
       shadow_enabled,
       champion_model_version,
       champion_training_run_id,
       champion_feature_contract_version,
       challenger_model_version,
       challenger_training_run_id,
       challenger_feature_contract_version,
       guardrail_min_multiplier,
       guardrail_max_multiplier,
       guardrail_max_change_ratio,
       minimum_confirmed_exposures,
       minimum_conversions,
       minimum_non_conversions,
       minimum_shadow_days,
       minimum_inference_coverage_ratio,
       maximum_inference_error_ratio,
       version,
       'Initial shadow evaluation policy',
       updated_at,
       updated_by
FROM ai_pricing_shadow_settings
WHERE setting_id = 1
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION capture_ai_pricing_shadow_setting_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'AI shadow setting version must increase by exactly one'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO ai_pricing_shadow_setting_audits (
    setting_id,
    shadow_enabled,
    champion_model_version,
    champion_training_run_id,
    champion_feature_contract_version,
    challenger_model_version,
    challenger_training_run_id,
    challenger_feature_contract_version,
    guardrail_min_multiplier,
    guardrail_max_multiplier,
    guardrail_max_change_ratio,
    minimum_confirmed_exposures,
    minimum_conversions,
    minimum_non_conversions,
    minimum_shadow_days,
    minimum_inference_coverage_ratio,
    maximum_inference_error_ratio,
    version,
    change_reason,
    changed_at,
    changed_by
  ) VALUES (
    NEW.setting_id,
    NEW.shadow_enabled,
    NEW.champion_model_version,
    NEW.champion_training_run_id,
    NEW.champion_feature_contract_version,
    NEW.challenger_model_version,
    NEW.challenger_training_run_id,
    NEW.challenger_feature_contract_version,
    NEW.guardrail_min_multiplier,
    NEW.guardrail_max_multiplier,
    NEW.guardrail_max_change_ratio,
    NEW.minimum_confirmed_exposures,
    NEW.minimum_conversions,
    NEW.minimum_non_conversions,
    NEW.minimum_shadow_days,
    NEW.minimum_inference_coverage_ratio,
    NEW.maximum_inference_error_ratio,
    NEW.version,
    COALESCE(NULLIF(BTRIM(current_setting('hotelai.ai_shadow_change_reason', TRUE)), ''),
             'Unspecified database policy update'),
    NEW.updated_at,
    NEW.updated_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_pricing_shadow_settings_audit_trigger
  ON ai_pricing_shadow_settings;
CREATE TRIGGER ai_pricing_shadow_settings_audit_trigger
AFTER UPDATE ON ai_pricing_shadow_settings
FOR EACH ROW
EXECUTE FUNCTION capture_ai_pricing_shadow_setting_audit();

CREATE OR REPLACE FUNCTION prepare_ai_pricing_shadow_setting_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := GREATEST(
    statement_timestamp(),
    OLD.updated_at + INTERVAL '1 microsecond'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_pricing_shadow_settings_prepare_trigger
  ON ai_pricing_shadow_settings;
CREATE TRIGGER ai_pricing_shadow_settings_prepare_trigger
BEFORE UPDATE ON ai_pricing_shadow_settings
FOR EACH ROW
EXECUTE FUNCTION prepare_ai_pricing_shadow_setting_update();

CREATE OR REPLACE FUNCTION prevent_ai_pricing_shadow_setting_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI shadow singleton setting cannot be removed; pause it instead'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS ai_pricing_shadow_settings_removal_trigger
  ON ai_pricing_shadow_settings;
CREATE TRIGGER ai_pricing_shadow_settings_removal_trigger
BEFORE DELETE OR TRUNCATE ON ai_pricing_shadow_settings
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ai_pricing_shadow_setting_removal();

CREATE OR REPLACE FUNCTION prevent_ai_pricing_shadow_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('hotelai.allow_ai_shadow_cleanup', TRUE) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'AI shadow audit ledger is append-only; % is not allowed', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS ai_pricing_shadow_setting_audits_append_only_trigger
  ON ai_pricing_shadow_setting_audits;
CREATE TRIGGER ai_pricing_shadow_setting_audits_append_only_trigger
BEFORE UPDATE OR DELETE OR TRUNCATE ON ai_pricing_shadow_setting_audits
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ai_pricing_shadow_audit_mutation();

CREATE TABLE IF NOT EXISTS ai_pricing_shadow_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL,
  control_version INT NOT NULL,
  outcome VARCHAR(30) NOT NULL,
  inference_latency_ms INT,
  error_code VARCHAR(100),
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_pricing_shadow_attempts_quote_control_unique
    UNIQUE (quote_id, control_version),
  CONSTRAINT ai_pricing_shadow_attempts_quote_fk
    FOREIGN KEY (quote_id) REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  CONSTRAINT ai_pricing_shadow_attempts_control_fk
    FOREIGN KEY (control_version)
    REFERENCES ai_pricing_shadow_setting_audits(version) ON DELETE RESTRICT,
  CONSTRAINT ai_pricing_shadow_attempts_outcome_check CHECK (
    outcome IN ('succeeded', 'unavailable', 'timeout', 'error', 'lineage_mismatch')
  ),
  CONSTRAINT ai_pricing_shadow_attempts_error_check CHECK (
    (outcome = 'succeeded' AND error_code IS NULL)
    OR
    (outcome <> 'succeeded' AND NULLIF(BTRIM(error_code), '') IS NOT NULL)
  ),
  CONSTRAINT ai_pricing_shadow_attempts_latency_check CHECK (
    inference_latency_ms IS NULL OR inference_latency_ms BETWEEN 0 AND 600000
  ),
  CONSTRAINT ai_pricing_shadow_attempts_idempotency_check CHECK (
    idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_pricing_shadow_attempts_control_time
  ON ai_pricing_shadow_attempts (control_version, occurred_at, attempt_id);

CREATE OR REPLACE FUNCTION prevent_ai_pricing_shadow_attempt_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('hotelai.allow_ai_shadow_cleanup', TRUE) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'AI shadow attempts are append-only; % is not allowed', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS ai_pricing_shadow_attempts_append_only_trigger
  ON ai_pricing_shadow_attempts;
CREATE TRIGGER ai_pricing_shadow_attempts_append_only_trigger
BEFORE UPDATE OR DELETE OR TRUNCATE ON ai_pricing_shadow_attempts
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ai_pricing_shadow_attempt_mutation();

CREATE TABLE IF NOT EXISTS ai_pricing_shadow_decisions (
  decision_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID NOT NULL UNIQUE,
  quote_id UUID NOT NULL UNIQUE,
  control_version INT NOT NULL,
  champion_model_version VARCHAR(100) NOT NULL,
  champion_training_run_id VARCHAR(100) NOT NULL,
  champion_feature_contract_version VARCHAR(50) NOT NULL,
  champion_multiplier NUMERIC(8, 6) NOT NULL,
  challenger_model_version VARCHAR(100) NOT NULL,
  challenger_training_run_id VARCHAR(100) NOT NULL,
  challenger_feature_contract_version VARCHAR(50) NOT NULL,
  predicted_conversion_probability NUMERIC(9, 8),
  proposed_multiplier NUMERIC(8, 6),
  guardrailed_multiplier NUMERIC(8, 6),
  multiplier_delta_from_champion NUMERIC(9, 6),
  relative_price_delta_from_champion NUMERIC(9, 6),
  guardrail_status VARCHAR(30) NOT NULL,
  guardrail_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  inference_latency_ms INT,
  source VARCHAR(30) NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_pricing_shadow_decisions_quote_fk
    FOREIGN KEY (quote_id) REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  CONSTRAINT ai_pricing_shadow_decisions_attempt_fk
    FOREIGN KEY (attempt_id)
    REFERENCES ai_pricing_shadow_attempts(attempt_id) ON DELETE RESTRICT,
  CONSTRAINT ai_pricing_shadow_decisions_control_fk
    FOREIGN KEY (control_version)
    REFERENCES ai_pricing_shadow_setting_audits(version) ON DELETE RESTRICT,
  CONSTRAINT ai_pricing_shadow_decisions_probability_check CHECK (
    predicted_conversion_probability IS NULL
    OR predicted_conversion_probability BETWEEN 0 AND 1
  ),
  CONSTRAINT ai_pricing_shadow_decisions_proposal_check CHECK (
    proposed_multiplier IS NULL OR proposed_multiplier BETWEEN 0.1 AND 5
  ),
  CONSTRAINT ai_pricing_shadow_decisions_output_check CHECK (
    predicted_conversion_probability IS NOT NULL OR proposed_multiplier IS NOT NULL
  ),
  CONSTRAINT ai_pricing_shadow_decisions_guardrail_check CHECK (
    (proposed_multiplier IS NULL
      AND guardrailed_multiplier IS NULL
      AND multiplier_delta_from_champion IS NULL
      AND relative_price_delta_from_champion IS NULL
      AND guardrail_status = 'not_applicable')
    OR
    (proposed_multiplier IS NOT NULL
      AND guardrailed_multiplier IS NOT NULL
      AND multiplier_delta_from_champion IS NOT NULL
      AND relative_price_delta_from_champion IS NOT NULL
      AND guardrail_status IN ('within_policy', 'adjusted', 'policy_conflict'))
  ),
  CONSTRAINT ai_pricing_shadow_decisions_latency_check CHECK (
    inference_latency_ms IS NULL OR inference_latency_ms BETWEEN 0 AND 600000
  ),
  CONSTRAINT ai_pricing_shadow_decisions_source_check CHECK (BTRIM(source) <> ''),
  CONSTRAINT ai_pricing_shadow_decisions_idempotency_check CHECK (
    idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_pricing_shadow_decisions_control_time
  ON ai_pricing_shadow_decisions (control_version, occurred_at, decision_id);

CREATE INDEX IF NOT EXISTS idx_ai_pricing_shadow_decisions_challenger_time
  ON ai_pricing_shadow_decisions (
    challenger_model_version,
    challenger_training_run_id,
    occurred_at DESC
  );

CREATE OR REPLACE FUNCTION prepare_ai_pricing_shadow_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  policy ai_pricing_shadow_setting_audits%ROWTYPE;
  attempt_record ai_pricing_shadow_attempts%ROWTYPE;
  quote_record RECORD;
  lower_bound NUMERIC;
  upper_bound NUMERIC;
  reasons TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT * INTO policy
  FROM ai_pricing_shadow_setting_audits
  WHERE version = NEW.control_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown AI shadow control version %', NEW.control_version
      USING ERRCODE = '23503';
  END IF;
  IF NOT policy.shadow_enabled THEN
    RAISE EXCEPTION 'AI shadow evaluation is paused for control version %', NEW.control_version
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO attempt_record
  FROM ai_pricing_shadow_attempts
  WHERE attempt_id = NEW.attempt_id;
  IF NOT FOUND
     OR attempt_record.quote_id IS DISTINCT FROM NEW.quote_id
     OR attempt_record.control_version IS DISTINCT FROM NEW.control_version
     OR attempt_record.outcome <> 'succeeded' THEN
    RAISE EXCEPTION 'Shadow decision must reference its successful matching attempt'
      USING ERRCODE = '23514';
  END IF;
  NEW.inference_latency_ms := attempt_record.inference_latency_ms;
  NEW.occurred_at := attempt_record.occurred_at;

  IF NEW.challenger_model_version IS DISTINCT FROM policy.challenger_model_version
     OR NEW.challenger_training_run_id IS DISTINCT FROM policy.challenger_training_run_id
     OR NEW.challenger_feature_contract_version
        IS DISTINCT FROM policy.challenger_feature_contract_version THEN
    RAISE EXCEPTION 'Challenger lineage does not match control version %', NEW.control_version
      USING ERRCODE = '23514';
  END IF;

  SELECT pricing_source,
         ai_model_version,
         ai_training_run_id,
         ai_feature_contract_version,
         ai_multiplier
  INTO quote_record
  FROM pricing_quotes
  WHERE quote_id = NEW.quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown quote %', NEW.quote_id USING ERRCODE = '23503';
  END IF;
  IF quote_record.pricing_source <> 'ai' THEN
    RAISE EXCEPTION 'Shadow decisions require an AI-served quote'
      USING ERRCODE = '23514';
  END IF;
  IF quote_record.ai_model_version IS DISTINCT FROM policy.champion_model_version
     OR quote_record.ai_training_run_id IS DISTINCT FROM policy.champion_training_run_id
     OR quote_record.ai_feature_contract_version
        IS DISTINCT FROM policy.champion_feature_contract_version THEN
    RAISE EXCEPTION 'Quote champion lineage does not match control version %', NEW.control_version
      USING ERRCODE = '23514';
  END IF;

  NEW.champion_model_version := quote_record.ai_model_version;
  NEW.champion_training_run_id := quote_record.ai_training_run_id;
  NEW.champion_feature_contract_version := quote_record.ai_feature_contract_version;
  NEW.champion_multiplier := quote_record.ai_multiplier;

  IF NEW.proposed_multiplier IS NULL THEN
    NEW.guardrailed_multiplier := NULL;
    NEW.multiplier_delta_from_champion := NULL;
    NEW.relative_price_delta_from_champion := NULL;
    NEW.guardrail_status := 'not_applicable';
    NEW.guardrail_reasons := ARRAY[]::TEXT[];
    RETURN NEW;
  END IF;

  lower_bound := GREATEST(
    policy.guardrail_min_multiplier,
    NEW.champion_multiplier * (1 - policy.guardrail_max_change_ratio)
  );
  upper_bound := LEAST(
    policy.guardrail_max_multiplier,
    NEW.champion_multiplier * (1 + policy.guardrail_max_change_ratio)
  );
  IF lower_bound > upper_bound THEN
    NEW.guardrailed_multiplier := NEW.champion_multiplier;
    NEW.multiplier_delta_from_champion := 0;
    NEW.relative_price_delta_from_champion := 0;
    NEW.guardrail_status := 'policy_conflict';
    NEW.guardrail_reasons := ARRAY['empty_policy_interval']::TEXT[];
    RETURN NEW;
  END IF;

  IF NEW.proposed_multiplier < policy.guardrail_min_multiplier THEN
    reasons := array_append(reasons, 'absolute_min');
  END IF;
  IF NEW.proposed_multiplier > policy.guardrail_max_multiplier THEN
    reasons := array_append(reasons, 'absolute_max');
  END IF;
  IF NEW.proposed_multiplier
       < NEW.champion_multiplier * (1 - policy.guardrail_max_change_ratio) THEN
    reasons := array_append(reasons, 'change_floor');
  END IF;
  IF NEW.proposed_multiplier
       > NEW.champion_multiplier * (1 + policy.guardrail_max_change_ratio) THEN
    reasons := array_append(reasons, 'change_ceiling');
  END IF;

  NEW.guardrailed_multiplier := LEAST(
    upper_bound,
    GREATEST(lower_bound, NEW.proposed_multiplier)
  );
  NEW.multiplier_delta_from_champion :=
    NEW.guardrailed_multiplier - NEW.champion_multiplier;
  NEW.relative_price_delta_from_champion :=
    NEW.guardrailed_multiplier / NEW.champion_multiplier - 1;
  NEW.guardrail_reasons := reasons;
  NEW.guardrail_status := CASE
    WHEN CARDINALITY(reasons) = 0 THEN 'within_policy'
    ELSE 'adjusted'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_pricing_shadow_decisions_prepare_trigger
  ON ai_pricing_shadow_decisions;
CREATE TRIGGER ai_pricing_shadow_decisions_prepare_trigger
BEFORE INSERT ON ai_pricing_shadow_decisions
FOR EACH ROW
EXECUTE FUNCTION prepare_ai_pricing_shadow_decision();

CREATE OR REPLACE FUNCTION prevent_ai_pricing_shadow_decision_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('hotelai.allow_ai_shadow_cleanup', TRUE) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'AI shadow decisions are append-only; % is not allowed', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS ai_pricing_shadow_decisions_append_only_trigger
  ON ai_pricing_shadow_decisions;
CREATE TRIGGER ai_pricing_shadow_decisions_append_only_trigger
BEFORE UPDATE OR DELETE OR TRUNCATE ON ai_pricing_shadow_decisions
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ai_pricing_shadow_decision_mutation();

DROP VIEW IF EXISTS ai_pricing_shadow_readiness_v1;
CREATE VIEW ai_pricing_shadow_readiness_v1 AS
WITH policy_windows AS (
  SELECT policy.*,
         LEAD(policy.changed_at) OVER (ORDER BY policy.version) AS active_until
  FROM ai_pricing_shadow_setting_audits policy
),
opportunity_stats AS (
  SELECT policy.version AS control_version,
         COUNT(quote.quote_id)::int AS total_opportunity_quotes
  FROM policy_windows policy
  LEFT JOIN pricing_quotes quote
    ON policy.shadow_enabled
   AND quote.pricing_source = 'ai'
   AND quote.created_at >= policy.changed_at
   AND (policy.active_until IS NULL OR quote.created_at < policy.active_until)
  GROUP BY policy.version
),
attempt_facts AS (
  SELECT attempt.*,
         decision.decision_id,
         (
           policy.shadow_enabled
           AND quote.created_at >= policy.changed_at
           AND (policy.active_until IS NULL OR quote.created_at < policy.active_until)
         ) AS is_in_window
  FROM ai_pricing_shadow_attempts attempt
  INNER JOIN policy_windows policy ON policy.version = attempt.control_version
  INNER JOIN pricing_quotes quote ON quote.quote_id = attempt.quote_id
  LEFT JOIN ai_pricing_shadow_decisions decision
    ON decision.attempt_id = attempt.attempt_id
),
attempt_stats AS (
  SELECT attempt.control_version,
         COUNT(*)::int AS total_attempts,
         COUNT(*) FILTER (WHERE attempt.is_in_window)::int AS in_window_attempts,
         COUNT(*) FILTER (WHERE NOT attempt.is_in_window)::int
           AS out_of_window_attempts,
         COUNT(*) FILTER (
           WHERE attempt.is_in_window AND attempt.outcome = 'succeeded'
         )::int
           AS succeeded_attempts,
         COUNT(attempt.decision_id) FILTER (
           WHERE attempt.is_in_window AND attempt.outcome = 'succeeded'
         )::int AS succeeded_attempts_with_decisions,
         COUNT(*) FILTER (
           WHERE attempt.is_in_window
             AND attempt.outcome = 'succeeded'
             AND attempt.decision_id IS NULL
         )::int AS orphan_succeeded_attempts,
         COUNT(*) FILTER (
           WHERE attempt.is_in_window AND attempt.outcome <> 'succeeded'
         )::int
           AS failed_attempts,
         COUNT(*) FILTER (
           WHERE attempt.is_in_window AND attempt.outcome = 'lineage_mismatch'
         )::int
           AS lineage_mismatch_attempts,
         MAX(attempt.occurred_at) AS last_attempt_at
  FROM attempt_facts attempt
  GROUP BY attempt.control_version
),
decision_stats AS (
  SELECT decision.control_version,
         COUNT(*)::int AS total_decisions,
         COUNT(DISTINCT decision.occurred_at::date)::int AS shadow_observation_days,
         COUNT(*) FILTER (WHERE dataset.exposure_confirmed)::int
           AS confirmed_exposure_decisions,
         COUNT(*) FILTER (
           WHERE dataset.exposure_confirmed
             AND dataset.acceptance_label IS NOT NULL
         )::int AS matured_labeled_decisions,
         COUNT(*) FILTER (
           WHERE dataset.exposure_confirmed
             AND dataset.acceptance_label IS NOT NULL
             AND dataset.inventory_snapshot_consistent IS TRUE
             AND NOT dataset.has_disposition_conflict
         )::int AS eligible_matured_decisions,
         COUNT(*) FILTER (
           WHERE dataset.exposure_confirmed
             AND dataset.acceptance_label IS TRUE
             AND dataset.inventory_snapshot_consistent IS TRUE
             AND NOT dataset.has_disposition_conflict
         )::int AS accepted_decisions,
         COUNT(*) FILTER (
           WHERE dataset.exposure_confirmed
             AND dataset.acceptance_label IS FALSE
             AND dataset.inventory_snapshot_consistent IS TRUE
             AND NOT dataset.has_disposition_conflict
         )::int AS non_accepted_decisions,
         COUNT(*) FILTER (
           WHERE dataset.exposure_confirmed
             AND dataset.acceptance_label IS NOT NULL
             AND (
               dataset.inventory_snapshot_consistent IS DISTINCT FROM TRUE
               OR dataset.has_disposition_conflict
             )
         )::int AS excluded_data_quality_decisions,
         COUNT(*) FILTER (
           WHERE decision.guardrail_status = 'adjusted'
         )::int AS guardrail_adjusted_decisions,
         ROUND(
           AVG(ABS(decision.multiplier_delta_from_champion)) FILTER (
             WHERE decision.proposed_multiplier IS NOT NULL
           ),
           6
         ) AS mean_absolute_multiplier_delta,
         ROUND(
           AVG(
             POWER(
               decision.predicted_conversion_probability
                 - CASE WHEN dataset.acceptance_label THEN 1 ELSE 0 END,
               2
             )
           ) FILTER (
             WHERE dataset.exposure_confirmed
               AND dataset.acceptance_label IS NOT NULL
               AND dataset.inventory_snapshot_consistent IS TRUE
               AND NOT dataset.has_disposition_conflict
               AND decision.predicted_conversion_probability IS NOT NULL
           ),
           8
         ) AS conversion_brier_score,
         MAX(decision.occurred_at) AS last_decision_at
  FROM ai_pricing_shadow_decisions decision
  INNER JOIN pricing_quote_training_dataset_v1 dataset
    ON dataset.quote_id = decision.quote_id
  INNER JOIN policy_windows policy ON policy.version = decision.control_version
  WHERE policy.shadow_enabled
    AND dataset.generated_at >= policy.changed_at
    AND (policy.active_until IS NULL OR dataset.generated_at < policy.active_until)
  GROUP BY decision.control_version
)
SELECT policy.version AS control_version,
       (policy.version = current_setting.version) AS is_current_control,
       policy.challenger_model_version,
       policy.challenger_training_run_id,
       policy.challenger_feature_contract_version,
       policy.shadow_enabled,
       policy.minimum_confirmed_exposures,
       policy.minimum_conversions,
       policy.minimum_non_conversions,
       policy.minimum_shadow_days,
       policy.minimum_inference_coverage_ratio,
       policy.maximum_inference_error_ratio,
       COALESCE(opportunity.total_opportunity_quotes, 0) AS total_opportunity_quotes,
       COALESCE(attempt.total_attempts, 0) AS total_attempts,
       COALESCE(attempt.in_window_attempts, 0) AS in_window_attempts,
       COALESCE(attempt.out_of_window_attempts, 0) AS out_of_window_attempts,
       COALESCE(attempt.succeeded_attempts, 0) AS succeeded_attempts,
       COALESCE(attempt.succeeded_attempts_with_decisions, 0)
         AS succeeded_attempts_with_decisions,
       COALESCE(attempt.orphan_succeeded_attempts, 0) AS orphan_succeeded_attempts,
       COALESCE(attempt.failed_attempts, 0) AS failed_attempts,
       COALESCE(attempt.lineage_mismatch_attempts, 0) AS lineage_mismatch_attempts,
       CASE
         WHEN COALESCE(opportunity.total_opportunity_quotes, 0) = 0 THEN NULL
         ELSE ROUND(
           COALESCE(attempt.succeeded_attempts_with_decisions, 0)::numeric
             / opportunity.total_opportunity_quotes,
           6
         )
       END AS inference_coverage_ratio,
       CASE
         WHEN COALESCE(attempt.in_window_attempts, 0) = 0 THEN NULL
         ELSE ROUND(
           (
             COALESCE(attempt.failed_attempts, 0)
               + COALESCE(attempt.orphan_succeeded_attempts, 0)
           )::numeric / attempt.in_window_attempts,
           6
         )
       END AS inference_error_ratio,
       COALESCE(decision.total_decisions, 0) AS total_decisions,
       COALESCE(decision.shadow_observation_days, 0) AS shadow_observation_days,
       COALESCE(decision.confirmed_exposure_decisions, 0)
         AS confirmed_exposure_decisions,
       COALESCE(decision.matured_labeled_decisions, 0) AS matured_labeled_decisions,
       COALESCE(decision.eligible_matured_decisions, 0) AS eligible_matured_decisions,
       COALESCE(decision.accepted_decisions, 0) AS accepted_decisions,
       COALESCE(decision.non_accepted_decisions, 0) AS non_accepted_decisions,
       COALESCE(decision.excluded_data_quality_decisions, 0)
         AS excluded_data_quality_decisions,
       COALESCE(decision.guardrail_adjusted_decisions, 0)
         AS guardrail_adjusted_decisions,
       decision.mean_absolute_multiplier_delta,
       decision.conversion_brier_score,
       CASE
         WHEN policy.version <> current_setting.version THEN 'retired'
         WHEN NOT policy.shadow_enabled THEN 'paused'
         WHEN COALESCE(attempt.out_of_window_attempts, 0) > 0
           THEN 'out_of_window_attempts'
         WHEN COALESCE(opportunity.total_opportunity_quotes, 0) = 0 THEN 'collecting'
         WHEN COALESCE(attempt.lineage_mismatch_attempts, 0) > 0
           THEN 'lineage_mismatch'
         WHEN COALESCE(attempt.in_window_attempts, 0) > 0
              AND (
                COALESCE(attempt.failed_attempts, 0)
                  + COALESCE(attempt.orphan_succeeded_attempts, 0)
              )::numeric / attempt.in_window_attempts
                > policy.maximum_inference_error_ratio
           THEN 'excess_inference_errors'
         WHEN COALESCE(attempt.succeeded_attempts_with_decisions, 0)::numeric
                / opportunity.total_opportunity_quotes
              < policy.minimum_inference_coverage_ratio
           THEN 'insufficient_inference_coverage'
         WHEN COALESCE(decision.shadow_observation_days, 0) < policy.minimum_shadow_days
           THEN 'insufficient_shadow_days'
         WHEN COALESCE(decision.excluded_data_quality_decisions, 0) > 0
           THEN 'data_quality_exclusions'
         WHEN COALESCE(decision.eligible_matured_decisions, 0)
              < policy.minimum_confirmed_exposures
           THEN 'insufficient_confirmed_exposures'
         WHEN COALESCE(decision.accepted_decisions, 0) < policy.minimum_conversions
           THEN 'insufficient_conversions'
         WHEN COALESCE(decision.non_accepted_decisions, 0)
              < policy.minimum_non_conversions
           THEN 'insufficient_non_conversions'
         ELSE 'ready_for_offline_review'
       END AS readiness_status,
       attempt.last_attempt_at,
       decision.last_decision_at
FROM policy_windows policy
CROSS JOIN ai_pricing_shadow_settings current_setting
LEFT JOIN opportunity_stats opportunity ON opportunity.control_version = policy.version
LEFT JOIN attempt_stats attempt ON attempt.control_version = policy.version
LEFT JOIN decision_stats decision ON decision.control_version = policy.version;

COMMENT ON TABLE ai_pricing_shadow_settings IS
  'Versioned manual control plane for shadow evaluation; it does not deploy or promote models.';
COMMENT ON TABLE ai_pricing_shadow_setting_audits IS
  'Append-only snapshots of every AI shadow/guardrail policy version.';
COMMENT ON TABLE ai_pricing_shadow_attempts IS
  'Append-only coverage/error ledger for every configured shadow inference opportunity.';
COMMENT ON TABLE ai_pricing_shadow_decisions IS
  'Append-only challenger observations linked to immutable pricing quotes; no PII is copied.';
COMMENT ON VIEW ai_pricing_shadow_readiness_v1 IS
  'Review readiness based only on confirmed exposures and mature conversion labels; never a promotion signal.';
