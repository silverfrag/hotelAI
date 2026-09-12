CREATE TABLE IF NOT EXISTS event_outbox (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error VARCHAR(500),
  CONSTRAINT event_outbox_aggregate_type_check CHECK (aggregate_type <> ''),
  CONSTRAINT event_outbox_aggregate_id_check CHECK (aggregate_id <> ''),
  CONSTRAINT event_outbox_event_type_check CHECK (event_type <> ''),
  CONSTRAINT event_outbox_payload_object_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT event_outbox_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
  ON event_outbox (next_attempt_at ASC, occurred_at ASC, event_id ASC)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_outbox_pending_aggregate_order
  ON event_outbox (aggregate_type, aggregate_id, occurred_at ASC, event_id ASC)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_outbox_published_at
  ON event_outbox (published_at DESC)
  WHERE published_at IS NOT NULL;
