-- Fresh database initialization only, after init_schema.sql and seed.sql.
-- Never execute manually on an existing installation: an empty ledger authorizes
-- replay of all migrations. Existing installations need verified baseline adoption.
CREATE TABLE public.schema_migrations (
  name text PRIMARY KEY,
  checksum varchar(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  execution_ms integer NOT NULL CHECK (execution_ms >= 0)
);
