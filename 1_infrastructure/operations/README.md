# Isolated operational validation

`compose.test.yml` is a disposable backend/AI/infrastructure stack, **not a deployment configuration**. It contains no frontend, nginx, fixed container names, or live-stack volumes. All published ports bind only to loopback. Its deliberately identifiable credentials are for local validation only.

From the repository root:

```powershell
node --test 1_infrastructure/operations/operations.test.mjs
docker compose -f 1_infrastructure/operations/compose.test.yml config --quiet
docker compose -f 1_infrastructure/operations/compose.test.yml up --build -d --wait
docker compose -f 1_infrastructure/operations/compose.test.yml ps -a
docker compose -f 1_infrastructure/operations/compose.test.yml run --rm db_migrations node /operations/migrate.mjs --check
```

The migration service installs every checked-in migration after the baseline schema and sample seed finish. It records normalized SHA-256 checksums in `schema_migrations`, takes a database advisory lock, and commits each migration and its ledger entry together. `--check` fails if history is absent, modified, incomplete, or ahead of the release. `--apply` applies only the unapplied suffix. A failure rolls back that migration, not preceding successfully committed migrations. Never change already-applied migration files in a released environment; add a new migration.

Fresh databases receive an empty ledger from `init-migration-history.sql` during PostgreSQL entrypoint initialization. The runner **refuses existing application schemas without a ledger**, including older installations that ran migrations with psql. Do not bypass this by manually creating an empty ledger or rerunning all historic migrations: historic definitions can regress newer constraints/triggers. An upgrade needs a backup and restore drill, confirmation of the exact previously applied migration prefix using the old release and database catalog, and a reviewed baseline-adoption operation recording those exact checksums. Automatic baseline adoption is intentionally not provided. Until that review exists, an unmanaged installation is blocked from upgrade, not marked ready.

The optional `migration-integration.test.mjs` tests replay, real DDL rollback, checksum rejection and two concurrent migration runners. It requires `OPS_MIGRATION_INTEGRATION=1` plus explicit `DB_HOST=127.0.0.1`, `DB_PORT=55442`, `DB_USER=hotel_validation`, `DB_NAME=hotel_validation`, and the validation password. It creates a randomly named `hotel_validation_migrations_probe_*` database and drops that exact scratch database when done. No existing database is dropped.

| Surface | Local address |
| --- | --- |
| Core API | `http://127.0.0.1:53002/api/v1/core` |
| AI API | `http://127.0.0.1:58000` |
| PostgreSQL | `127.0.0.1:55442`, database/user `hotel_validation` |
| Redis | `redis://127.0.0.1:56380` |
| Kafka | `127.0.0.1:59093` |

### Browser checks when Windows reserves infrastructure host ports

If Docker reports that Windows cannot bind port 56380 or 59093, check the excluded port
ranges first (`netsh interface ipv4 show excludedportrange protocol=tcp`). For
browser and HTTP checks, Redis and Kafka do not need published host ports. The
optional overlay keeps both on the private validation network:

```powershell
docker compose -f 1_infrastructure/operations/compose.test.yml -f 1_infrastructure/operations/compose.browser-test.yml up --no-deps -d --wait redis kafka
```

This overlay requires Docker Compose support for `!reset` (verified with v5.4.0).
It changes only validation Redis/Kafka port publication and removes Kafka's
external listener; it does not modify Windows network settings. Core continues
to use `redis:6379` and `kafka:29092` inside Docker. Existing validation volumes
remain intact when these two containers are recreated. Host-side infrastructure
scripts and `run-validation.mjs` still require the normal published ports; do not
run those suites against the browser-only overlay.

When resuming retained test evidence, preserve the database configured in the
existing core container. If Compose `start` reports that its completed one-shot
`db_migrations` dependency no longer exists, verify the retained database's
migration history before starting that existing core container directly. Do not
recreate core with the base default database or replay migrations merely to
restore a browser session.

For smoke scripts that support environment overrides, set `API_BASE_URL`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `REDIS_URL`, and `KAFKA_BROKERS` explicitly to this stack. Do not load the live `.env` or run the existing top-level smoke suite without verifying its restart/outage targets: some older scripts operate on the default compose project. Restarting or pausing validation services must always include `-f 1_infrastructure/operations/compose.test.yml`.

The repeatable backend-only runner creates a fresh scratch database (previous
evidence is retained), clears only the isolated room-catalog cache key, provisions
a restricted validation app login and runs every backend suite without loading
the live .env:

```powershell
node 1_infrastructure/operations/run-validation.mjs
node 1_infrastructure/operations/run-validation.mjs booking-workflow-smoke-test
node 1_infrastructure/operations/restore-drill.mjs hotel_validation_run_<suffix>
node 1_infrastructure/operations/production-guard-smoke.mjs hotel_validation_run_<suffix>
```

Use the exact database name printed by the runner for the last two commands.
The restore drill keeps its new restored DB and writes a custom-format archive,
SHA-256 and verification report under .tmp/operations-evidence. These archives
contain test data and are not encrypted/offsite production backups. Do not use
the validation credentials or retained synthetic rows for production/training.

To stop the validation stack while retaining its evidence/data:

```powershell
docker compose -f 1_infrastructure/operations/compose.test.yml stop
```

Use `down` with this exact file only when validation is finished; it retains named volumes unless `--volumes` is added. Removing validation volumes permanently deletes the validation database and Kafka evidence; first verify the project name and keep any required reports. This does not authorize deletion of the live stack or its volumes.

Passing this isolated stack is necessary evidence, not a claim of production readiness. Real release gates still include production secrets/TLS, a least-privilege runtime database role, tested backup restoration and recovery objectives, payment-provider credentials and reconciliation, real-data AI quality approval, observability/alert delivery, and an explicit launch decision.
