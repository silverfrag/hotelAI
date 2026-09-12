-- Quote feedback dataset foundation.
--
-- pricing_quotes remains the immutable offer/feature snapshot. This migration
-- adds an append-only event ledger for facts that happen after generation and
-- a read model with censor-aware labels for conversion/stay training.

ALTER TABLE pricing_quotes
  ADD COLUMN IF NOT EXISTS rooms_sellable_snapshot INT,
  ADD COLUMN IF NOT EXISTS rooms_booked_snapshot INT,
  ADD COLUMN IF NOT EXISTS occupancy_ratio_snapshot NUMERIC(7, 6),
  ADD COLUMN IF NOT EXISTS inventory_snapshot_at TIMESTAMPTZ;

ALTER TABLE pricing_quotes
  DROP CONSTRAINT IF EXISTS pricing_quotes_inventory_snapshot_check;
ALTER TABLE pricing_quotes
  ADD CONSTRAINT pricing_quotes_inventory_snapshot_check CHECK (
    (
      rooms_sellable_snapshot IS NULL
      AND rooms_booked_snapshot IS NULL
      AND occupancy_ratio_snapshot IS NULL
      AND inventory_snapshot_at IS NULL
    )
    OR (
      rooms_sellable_snapshot IS NOT NULL
      AND rooms_sellable_snapshot >= 0
      AND rooms_booked_snapshot IS NOT NULL
      AND rooms_booked_snapshot BETWEEN 0 AND rooms_sellable_snapshot
      AND occupancy_ratio_snapshot IS NOT NULL
      AND occupancy_ratio_snapshot BETWEEN 0 AND 1
      AND inventory_snapshot_at IS NOT NULL
    )
  );

-- Existing quotes intentionally keep these fields NULL: calculating them from
-- today's inventory would leak future state into historical training rows.
CREATE OR REPLACE FUNCTION capture_pricing_quote_inventory_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  sellable_rooms INT;
  booked_rooms INT;
BEGIN
  IF NEW.rooms_sellable_snapshot IS NULL
     OR NEW.rooms_booked_snapshot IS NULL
     OR NEW.occupancy_ratio_snapshot IS NULL
     OR NEW.inventory_snapshot_at IS NULL THEN
    SELECT COUNT(*)::int
    INTO sellable_rooms
    FROM rooms
    WHERE type_id = NEW.room_type_id
      AND current_status <> 'Maintenance';

    -- rooms_available is the availability result already captured by the quote
    -- request. Its complement is the requested-stay booked inventory snapshot.
    booked_rooms := GREATEST(sellable_rooms - NEW.rooms_available, 0);

    NEW.rooms_sellable_snapshot := sellable_rooms;
    NEW.rooms_booked_snapshot := booked_rooms;
    NEW.occupancy_ratio_snapshot := CASE
      WHEN sellable_rooms = 0 THEN 0
      ELSE ROUND(booked_rooms::numeric / sellable_rooms::numeric, 6)
    END;
    NEW.inventory_snapshot_at := COALESCE(NEW.created_at, CURRENT_TIMESTAMP);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pricing_quotes_inventory_snapshot_trigger ON pricing_quotes;
CREATE TRIGGER pricing_quotes_inventory_snapshot_trigger
BEFORE INSERT ON pricing_quotes
FOR EACH ROW
EXECUTE FUNCTION capture_pricing_quote_inventory_snapshot();

-- Only the one-way acceptance linkage may change after a quote is generated.
-- Feature, price, inventory and model lineage remain an immutable observation;
-- otherwise historical training rows could silently change after exposure.
CREATE OR REPLACE FUNCTION enforce_pricing_quote_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  accepting_quote BOOLEAN;
  anonymizing_customer BOOLEAN;
BEGIN
  IF ROW(
    OLD.quote_id,
    OLD.room_type_id,
    OLD.room_type_name_snapshot,
    OLD.capacity_snapshot,
    OLD.check_in_date,
    OLD.check_out_date,
    OLD.guest_count,
    OLD.total_of_special_requests,
    OLD.lead_time,
    OLD.is_weekend,
    OLD.rooms_available,
    OLD.rooms_sellable_snapshot,
    OLD.rooms_booked_snapshot,
    OLD.occupancy_ratio_snapshot,
    OLD.inventory_snapshot_at,
    OLD.base_price,
    OLD.ai_multiplier,
    OLD.nightly_price,
    OLD.total_price,
    OLD.currency,
    OLD.pricing_source,
    OLD.settings_version,
    OLD.ai_model_version,
    OLD.ai_training_run_id,
    OLD.ai_feature_contract_version,
    OLD.created_at,
    OLD.expires_at
  ) IS DISTINCT FROM ROW(
    NEW.quote_id,
    NEW.room_type_id,
    NEW.room_type_name_snapshot,
    NEW.capacity_snapshot,
    NEW.check_in_date,
    NEW.check_out_date,
    NEW.guest_count,
    NEW.total_of_special_requests,
    NEW.lead_time,
    NEW.is_weekend,
    NEW.rooms_available,
    NEW.rooms_sellable_snapshot,
    NEW.rooms_booked_snapshot,
    NEW.occupancy_ratio_snapshot,
    NEW.inventory_snapshot_at,
    NEW.base_price,
    NEW.ai_multiplier,
    NEW.nightly_price,
    NEW.total_price,
    NEW.currency,
    NEW.pricing_source,
    NEW.settings_version,
    NEW.ai_model_version,
    NEW.ai_training_run_id,
    NEW.ai_feature_contract_version,
    NEW.created_at,
    NEW.expires_at
  ) THEN
    RAISE EXCEPTION 'Pricing quote offer, feature and lineage snapshots are immutable'
      USING ERRCODE = '55000';
  END IF;

  accepting_quote := OLD.booking_id IS NULL
    AND OLD.accepted_at IS NULL
    AND NEW.booking_id IS NOT NULL
    AND NEW.accepted_at IS NOT NULL
    AND NEW.customer_id IS NOT NULL;
  anonymizing_customer := OLD.customer_id IS NOT NULL
    AND NEW.customer_id IS NULL
    AND OLD.booking_id IS NOT DISTINCT FROM NEW.booking_id
    AND OLD.accepted_at IS NOT DISTINCT FROM NEW.accepted_at;

  IF OLD.booking_id IS DISTINCT FROM NEW.booking_id
     OR OLD.accepted_at IS DISTINCT FROM NEW.accepted_at THEN
    IF NOT accepting_quote THEN
      RAISE EXCEPTION 'Pricing quote acceptance linkage is one-way and immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF OLD.customer_id IS DISTINCT FROM NEW.customer_id
     AND NOT accepting_quote
     AND NOT anonymizing_customer THEN
    RAISE EXCEPTION 'Pricing quote customer linkage cannot be reassigned'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pricing_quotes_immutability_trigger ON pricing_quotes;
CREATE TRIGGER pricing_quotes_immutability_trigger
BEFORE UPDATE ON pricing_quotes
FOR EACH ROW
EXECUTE FUNCTION enforce_pricing_quote_immutability();

CREATE TABLE IF NOT EXISTS pricing_quote_events (
  quote_event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  source VARCHAR(30) NOT NULL,
  session_id UUID,
  search_id UUID,
  idempotency_key VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pricing_quote_events_quote_fk
    FOREIGN KEY (quote_id) REFERENCES pricing_quotes(quote_id) ON DELETE RESTRICT,
  CONSTRAINT pricing_quote_events_quote_type_unique UNIQUE (quote_id, event_type),
  CONSTRAINT pricing_quote_events_type_check CHECK (
    event_type IN (
      'quote.generated.v1',
      'quote.exposed.v1',
      'quote.rejected.v1',
      'quote.accepted.v1',
      'booking.canceled.v1',
      'stay.completed.v1'
    )
  ),
  CONSTRAINT pricing_quote_events_source_check CHECK (BTRIM(source) <> ''),
  CONSTRAINT pricing_quote_events_idempotency_key_check CHECK (
    idempotency_key IS NULL
    OR idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'
  ),
  CONSTRAINT pricing_quote_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_quote_events_idempotency_key
  ON pricing_quote_events (quote_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pricing_quote_events_type_occurred
  ON pricing_quote_events (event_type, occurred_at, quote_id);

CREATE INDEX IF NOT EXISTS idx_pricing_quote_events_quote_occurred
  ON pricing_quote_events (quote_id, occurred_at, quote_event_id);

-- This ledger is an analytics source of truth. Corrections must be represented
-- as a new versioned event rather than rewriting a historical observation.
CREATE OR REPLACE FUNCTION prevent_pricing_quote_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Integration tests and future retention jobs may opt in explicitly inside
  -- their transaction. Normal application sessions cannot mutate the ledger.
  IF current_setting('hotelai.allow_quote_event_cleanup', TRUE) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'pricing_quote_events is append-only; % is not allowed', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS pricing_quote_events_append_only_trigger ON pricing_quote_events;
CREATE TRIGGER pricing_quote_events_append_only_trigger
BEFORE UPDATE OR DELETE OR TRUNCATE ON pricing_quote_events
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_pricing_quote_event_mutation();

-- New quote events enter the existing transactional outbox automatically.
-- Historical backfills are intentionally not replayed to Kafka.
CREATE OR REPLACE FUNCTION enqueue_pricing_quote_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source <> 'migration_backfill' THEN
    INSERT INTO event_outbox (
      aggregate_type,
      aggregate_id,
      event_type,
      payload,
      occurred_at
    ) VALUES (
      'pricing_quote',
      NEW.quote_id::text,
      NEW.event_type,
      jsonb_build_object(
        'quote_event_id', NEW.quote_event_id,
        'quote_id', NEW.quote_id,
        'session_id', NEW.session_id,
        'search_id', NEW.search_id,
        'source', NEW.source,
        'metadata', NEW.metadata
      ),
      NEW.occurred_at
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pricing_quote_events_outbox_trigger ON pricing_quote_events;
CREATE TRIGGER pricing_quote_events_outbox_trigger
AFTER INSERT ON pricing_quote_events
FOR EACH ROW
EXECUTE FUNCTION enqueue_pricing_quote_event();

-- Generated and accepted are database-observed state transitions. ON CONFLICT
-- makes the trigger safe under retries and migration re-runs.
CREATE OR REPLACE FUNCTION capture_pricing_quote_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO pricing_quote_events (
      quote_id, event_type, occurred_at, source
    ) VALUES (
      NEW.quote_id,
      'quote.generated.v1',
      NEW.created_at,
      'database_trigger'
    )
    ON CONFLICT (quote_id, event_type) DO NOTHING;

    IF NEW.booking_id IS NOT NULL THEN
      INSERT INTO pricing_quote_events (
        quote_id, event_type, occurred_at, source,
        metadata
      ) VALUES (
        NEW.quote_id,
        'quote.accepted.v1',
        COALESCE(NEW.accepted_at, CURRENT_TIMESTAMP),
        'database_trigger',
        jsonb_build_object('booking_id', NEW.booking_id)
      )
      ON CONFLICT (quote_id, event_type) DO NOTHING;
    END IF;
  ELSIF OLD.booking_id IS NULL AND NEW.booking_id IS NOT NULL THEN
    INSERT INTO pricing_quote_events (
      quote_id, event_type, occurred_at, source,
      metadata
    ) VALUES (
      NEW.quote_id,
      'quote.accepted.v1',
      COALESCE(NEW.accepted_at, CURRENT_TIMESTAMP),
      'database_trigger',
      jsonb_build_object('booking_id', NEW.booking_id)
    )
    ON CONFLICT (quote_id, event_type) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pricing_quotes_lifecycle_event_trigger ON pricing_quotes;
CREATE TRIGGER pricing_quotes_lifecycle_event_trigger
AFTER INSERT OR UPDATE OF booking_id ON pricing_quotes
FOR EACH ROW
EXECUTE FUNCTION capture_pricing_quote_lifecycle_event();

-- Canceled and completed stay outcomes are attached to the accepted quote even
-- when the booking transition is performed by a future service or direct SQL.
CREATE OR REPLACE FUNCTION capture_pricing_quote_booking_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  quote_event_type VARCHAR(50);
  quote_event_time TIMESTAMPTZ;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Canceled' THEN
    quote_event_type := 'booking.canceled.v1';
    quote_event_time := CURRENT_TIMESTAMP;
  ELSIF NEW.status = 'Completed' THEN
    quote_event_type := 'stay.completed.v1';
    quote_event_time := COALESCE(NEW.checked_out_at, CURRENT_TIMESTAMP);
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO pricing_quote_events (
    quote_id,
    event_type,
    occurred_at,
    source,
    metadata
  )
  SELECT quote.quote_id,
         quote_event_type,
         quote_event_time,
         'database_trigger',
         jsonb_build_object(
           'booking_id', NEW.booking_id,
           'previous_status', OLD.status,
           'new_status', NEW.status
         )
  FROM pricing_quotes quote
  WHERE quote.booking_id = NEW.booking_id
  ON CONFLICT (quote_id, event_type) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_quote_outcome_trigger ON bookings;
CREATE TRIGGER bookings_quote_outcome_trigger
AFTER UPDATE OF status ON bookings
FOR EACH ROW
EXECUTE FUNCTION capture_pricing_quote_booking_outcome();

-- Backfill only facts whose original timestamps are known. In particular, do
-- not reconstruct historical inventory or invent cancellation/completion time.
INSERT INTO pricing_quote_events (
  quote_id, event_type, occurred_at, source
)
SELECT quote_id, 'quote.generated.v1', created_at, 'migration_backfill'
FROM pricing_quotes
ON CONFLICT (quote_id, event_type) DO NOTHING;

INSERT INTO pricing_quote_events (
  quote_id, event_type, occurred_at, source, metadata
)
SELECT quote_id,
       'quote.accepted.v1',
       accepted_at,
       'migration_backfill',
       jsonb_build_object('booking_id', booking_id)
FROM pricing_quotes
WHERE booking_id IS NOT NULL
  AND accepted_at IS NOT NULL
ON CONFLICT (quote_id, event_type) DO NOTHING;

INSERT INTO pricing_quote_events (
  quote_id, event_type, occurred_at, source, metadata
)
SELECT quote.quote_id,
       'booking.canceled.v1',
       lifecycle.occurred_at,
       'migration_backfill',
       jsonb_build_object('booking_id', booking.booking_id)
FROM pricing_quotes quote
INNER JOIN bookings booking ON booking.booking_id = quote.booking_id
CROSS JOIN LATERAL (
  SELECT MIN(outbox.occurred_at) AS occurred_at
  FROM event_outbox outbox
  WHERE outbox.aggregate_type = 'booking'
    AND outbox.aggregate_id = booking.booking_id::text
    AND outbox.event_type = 'booking.canceled.v1'
) lifecycle
WHERE booking.status = 'Canceled'
  AND lifecycle.occurred_at IS NOT NULL
ON CONFLICT (quote_id, event_type) DO NOTHING;

INSERT INTO pricing_quote_events (
  quote_id, event_type, occurred_at, source, metadata
)
SELECT quote.quote_id,
       'stay.completed.v1',
       COALESCE(lifecycle.occurred_at, booking.checked_out_at),
       'migration_backfill',
       jsonb_build_object('booking_id', booking.booking_id)
FROM pricing_quotes quote
INNER JOIN bookings booking ON booking.booking_id = quote.booking_id
CROSS JOIN LATERAL (
  SELECT MIN(outbox.occurred_at) AS occurred_at
  FROM event_outbox outbox
  WHERE outbox.aggregate_type = 'booking'
    AND outbox.aggregate_id = booking.booking_id::text
    AND outbox.event_type IN ('booking.completed.v1', 'booking.checked-out.v1')
) lifecycle
WHERE booking.status = 'Completed'
  AND COALESCE(lifecycle.occurred_at, booking.checked_out_at) IS NOT NULL
ON CONFLICT (quote_id, event_type) DO NOTHING;

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
         event.generated_event_at,
         event.explicit_exposed_at,
         event.rejected_at,
         COALESCE(quote.accepted_at, event.accepted_event_at) AS resolved_accepted_at,
         event.booking_canceled_at,
         COALESCE(event.stay_completed_at, booking.checked_out_at) AS resolved_completed_at,
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
         WHEN facts.booking_status = 'Completed' THEN 'completed'
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
         WHEN facts.booking_status = 'Completed' THEN FALSE
         ELSE NULL
       END AS cancellation_label,
       CASE
         WHEN facts.booking_id IS NULL THEN NULL
         WHEN facts.booking_status = 'Completed' THEN TRUE
         WHEN facts.booking_status = 'Canceled' THEN FALSE
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
  'Censor-aware quote conversion/stay facts. Open quote labels are NULL; expiry is evaluated at query time.';
