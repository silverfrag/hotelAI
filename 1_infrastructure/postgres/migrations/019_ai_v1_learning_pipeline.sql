-- AI v1 quote snapshots and conversion evidence. Fresh schema additions only.
-- No historical prices are backfilled and no applied migration is modified.

CREATE TABLE ai_v1_policy_versions (
  policy_version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_key VARCHAR(100) NOT NULL UNIQUE,
  policy_source VARCHAR(40) NOT NULL CHECK (policy_source IN ('backend_policy','demo_business_assumption')),
  rounding_unit_vnd BIGINT NOT NULL CHECK (rounding_unit_vnd = 1000),
  rounding_rule VARCHAR(20) NOT NULL CHECK (rounding_rule = 'half_up'),
  approved_by VARCHAR(160) NOT NULL,
  change_reason VARCHAR(500) NOT NULL CHECK (length(btrim(change_reason)) BETWEEN 10 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  active_from TIMESTAMPTZ NOT NULL,
  active_until TIMESTAMPTZ,
  CHECK (active_until IS NULL OR active_until > active_from)
);

CREATE TABLE ai_v1_policy_rules (
  policy_rule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_version_id UUID NOT NULL REFERENCES ai_v1_policy_versions(policy_version_id) ON DELETE RESTRICT,
  room_type_id INT NOT NULL REFERENCES room_types(type_id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  effective_until DATE NOT NULL,
  policy_price NUMERIC(14,0) NOT NULL CHECK (policy_price > 0 AND mod(policy_price, 1000) = 0),
  floor_price NUMERIC(14,0) NOT NULL CHECK (floor_price > 0 AND mod(floor_price, 1000) = 0),
  ceiling_price NUMERIC(14,0) NOT NULL CHECK (ceiling_price > 0 AND mod(ceiling_price, 1000) = 0),
  variable_cost NUMERIC(14,0) NOT NULL CHECK (variable_cost >= 0 AND mod(variable_cost, 1000) = 0),
  CHECK (effective_until > effective_from),
  CHECK (floor_price <= policy_price AND policy_price <= ceiling_price AND variable_cost <= policy_price)
);

CREATE TABLE ai_v1_context_snapshots (
  context_snapshot_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evidence_sha256 CHAR(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at TIMESTAMPTZ NOT NULL,
  provenance VARCHAR(20) NOT NULL CHECK (provenance IN ('live','replay','test_fixture')),
  registry_version VARCHAR(100),
  parser_version VARCHAR(100),
  extractor_version VARCHAR(100),
  runtime_version VARCHAR(100),
  feature_contract_version VARCHAR(100) NOT NULL,
  facts JSONB NOT NULL CHECK (pg_column_size(facts) <= 262144),
  coverage JSONB NOT NULL CHECK (pg_column_size(coverage) <= 65536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE ai_v1_quote_decisions (
  decision_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL UNIQUE REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  context_snapshot_id UUID REFERENCES ai_v1_context_snapshots(context_snapshot_id) ON DELETE RESTRICT,
  policy_version_id UUID NOT NULL REFERENCES ai_v1_policy_versions(policy_version_id) ON DELETE RESTRICT,
  policy_inputs JSONB NOT NULL CHECK (pg_column_size(policy_inputs) <= 65536),
  feature_contract_version VARCHAR(100) NOT NULL,
  pricing_mode VARCHAR(16) NOT NULL CHECK (pricing_mode IN ('policy','shadow')),
  effective_source VARCHAR(32) NOT NULL CHECK (effective_source IN ('policy','policy_fallback')),
  fallback_reason VARCHAR(80),
  propensity NUMERIC(8,7) NOT NULL DEFAULT 1 CHECK (propensity = 1),
  displayed_total NUMERIC(14,0) NOT NULL CHECK (displayed_total > 0 AND mod(displayed_total,1000)=0),
  shadow_total NUMERIC(14,0) CHECK (shadow_total IS NULL OR (shadow_total > 0 AND mod(shadow_total,1000)=0)),
  shadow_probability_displayed DOUBLE PRECISION CHECK (shadow_probability_displayed BETWEEN 0 AND 1),
  shadow_probability_proposed DOUBLE PRECISION CHECK (shadow_probability_proposed BETWEEN 0 AND 1),
  model_version VARCHAR(100),
  training_run_id VARCHAR(100),
  traffic_origin VARCHAR(20) NOT NULL CHECK (traffic_origin IN ('guest','operator','seed','test','replay','internal','bot')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((pricing_mode='policy' AND shadow_total IS NULL AND shadow_probability_displayed IS NULL AND shadow_probability_proposed IS NULL)
      OR (pricing_mode='shadow' AND effective_source IN ('policy','policy_fallback')))
);

CREATE TABLE ai_v1_quote_nights (
  quote_id UUID NOT NULL REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  stay_date DATE NOT NULL,
  policy_price NUMERIC(14,0) NOT NULL CHECK (policy_price > 0 AND mod(policy_price,1000)=0),
  displayed_price NUMERIC(14,0) NOT NULL CHECK (displayed_price > 0 AND mod(displayed_price,1000)=0),
  shadow_price NUMERIC(14,0) CHECK (shadow_price IS NULL OR (shadow_price > 0 AND mod(shadow_price,1000)=0)),
  floor_price NUMERIC(14,0) NOT NULL,
  ceiling_price NUMERIC(14,0) NOT NULL,
  variable_cost NUMERIC(14,0) NOT NULL,
  rooms_available INT NOT NULL CHECK (rooms_available >= 0),
  policy_inputs JSONB NOT NULL CHECK (pg_column_size(policy_inputs) <= 32768),
  PRIMARY KEY (quote_id, stay_date),
  CHECK (floor_price <= displayed_price AND displayed_price <= ceiling_price AND variable_cost <= displayed_price)
);

ALTER TABLE booking_details
  ADD COLUMN total_price_snapshot NUMERIC(14,0),
  ADD COLUMN pricing_quote_id UUID REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT;
ALTER TABLE booking_details ADD CONSTRAINT booking_details_total_snapshot_check
  CHECK (total_price_snapshot IS NULL OR (total_price_snapshot > 0 AND mod(total_price_snapshot,1000)=0));
CREATE UNIQUE INDEX booking_details_pricing_quote_unique
  ON booking_details(pricing_quote_id) WHERE pricing_quote_id IS NOT NULL;

CREATE TABLE ai_v1_booking_nights (
  detail_id UUID NOT NULL REFERENCES booking_details(detail_id) ON DELETE RESTRICT,
  stay_date DATE NOT NULL,
  nightly_price NUMERIC(14,0) NOT NULL CHECK (nightly_price > 0 AND mod(nightly_price,1000)=0),
  policy_version_id UUID NOT NULL REFERENCES ai_v1_policy_versions(policy_version_id) ON DELETE RESTRICT,
  context_snapshot_id UUID REFERENCES ai_v1_context_snapshots(context_snapshot_id) ON DELETE RESTRICT,
  PRIMARY KEY (detail_id, stay_date)
);

CREATE TABLE ai_v1_exposures (
  exposure_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL UNIQUE REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  journey_hmac CHAR(64) NOT NULL CHECK (journey_hmac ~ '^[0-9a-f]{64}$'),
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  policy_version_id UUID NOT NULL REFERENCES ai_v1_policy_versions(policy_version_id) ON DELETE RESTRICT,
  displayed_total NUMERIC(14,0) NOT NULL CHECK (displayed_total > 0 AND mod(displayed_total,1000)=0),
  propensity NUMERIC(8,7) NOT NULL DEFAULT 1 CHECK (propensity=1),
  eligibility VARCHAR(20) NOT NULL CHECK (eligibility IN ('eligible','excluded')),
  exclusion_reason VARCHAR(80),
  CHECK ((eligibility='eligible' AND exclusion_reason IS NULL) OR (eligibility='excluded' AND exclusion_reason IS NOT NULL))
);

CREATE TABLE ai_v1_quote_supersessions (
  old_quote_id UUID PRIMARY KEY REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  new_quote_id UUID NOT NULL UNIQUE REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  journey_hmac CHAR(64) NOT NULL CHECK (journey_hmac ~ '^[0-9a-f]{64}$'),
  superseded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (old_quote_id <> new_quote_id)
);

CREATE TABLE ai_v1_quote_rejections (
  quote_id UUID PRIMARY KEY REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  journey_hmac CHAR(64) NOT NULL CHECK (journey_hmac ~ '^[0-9a-f]{64}$'),
  negative_reason VARCHAR(32) NOT NULL CHECK (negative_reason='explicit_reject'),
  rejected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE ai_v1_admin_audit (
  audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id VARCHAR(160) NOT NULL,
  action VARCHAR(16) NOT NULL CHECK (action IN ('refresh','export')),
  scope VARCHAR(200) NOT NULL,
  result VARCHAR(32) NOT NULL,
  evidence_sha256 CHAR(64) CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[0-9a-f]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX ai_v1_policy_rules_lookup_idx ON ai_v1_policy_rules(room_type_id,effective_from,effective_until);
CREATE INDEX ai_v1_quote_decisions_policy_idx ON ai_v1_quote_decisions(policy_version_id,created_at);
CREATE INDEX ai_v1_exposures_journey_idx ON ai_v1_exposures(journey_hmac,server_received_at);

-- The approved demo assumptions are installed only in the isolated demo DB.
-- Production databases receive schema only and must supply approved business
-- policy before the AI v1 quote path can be enabled.
DO $$
DECLARE policy_id UUID;
BEGIN
  IF current_database() = 'hotelai_ai_v1_demo' THEN
    INSERT INTO ai_v1_policy_versions(version_key,policy_source,rounding_unit_vnd,rounding_rule,
      approved_by,change_reason,active_from)
    VALUES ('demo-business-assumption-2026-11-10','demo_business_assumption',1000,'half_up',
      'user_chat_2026-11-10','User approved demo-only floor 80%, ceiling 130%, variable cost 50% of backend base price; excluded from operational training.',clock_timestamp())
    ON CONFLICT(version_key) DO NOTHING;
    SELECT policy_version_id INTO policy_id FROM ai_v1_policy_versions
      WHERE version_key='demo-business-assumption-2026-11-10';
    INSERT INTO ai_v1_policy_rules(policy_version_id,room_type_id,effective_from,effective_until,
      policy_price,floor_price,ceiling_price,variable_cost)
    SELECT policy_id,room.type_id,DATE '2020-01-01',DATE '2100-01-01',
      round(room.base_price::numeric/1000)*1000,
      round(room.base_price::numeric*0.8/1000)*1000,
      round(room.base_price::numeric*1.3/1000)*1000,
      round(room.base_price::numeric*0.5/1000)*1000
    FROM room_types room
    WHERE NOT EXISTS (SELECT 1 FROM ai_v1_policy_rules existing
      WHERE existing.room_type_id=room.type_id AND existing.effective_from=DATE '2020-01-01'
        AND existing.effective_until=DATE '2100-01-01');
  END IF;
END $$;

CREATE FUNCTION ai_v1_guard_policy_rule_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.room_type_id);
  IF EXISTS (SELECT 1 FROM ai_v1_policy_rules rule
      WHERE rule.room_type_id=NEW.room_type_id
        AND rule.effective_from < NEW.effective_until
        AND rule.effective_until > NEW.effective_from) THEN
    RAISE EXCEPTION 'Overlapping AI v1 policy rules for room type %', NEW.room_type_id USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ai_v1_policy_rules_no_overlap BEFORE INSERT ON ai_v1_policy_rules
FOR EACH ROW EXECUTE FUNCTION ai_v1_guard_policy_rule_overlap();

-- Prevent silent edits to source, policy, context and quote evidence. These
-- append-only rows are removable only by an explicitly reviewed retention job.
CREATE FUNCTION ai_v1_reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI v1 evidence is append-only' USING ERRCODE='55000'; END; $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_v1_policy_versions','ai_v1_policy_rules','ai_v1_context_snapshots',
    'ai_v1_quote_decisions','ai_v1_quote_nights','ai_v1_booking_nights','ai_v1_exposures',
    'ai_v1_quote_supersessions','ai_v1_quote_rejections','ai_v1_admin_audit'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_v1_reject_evidence_mutation()', t||'_immutable', t);
  END LOOP;
END $$;
