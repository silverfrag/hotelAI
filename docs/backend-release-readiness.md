# Backend / AI release readiness

Status: pre-release, 2026-09-06. No frontend edits or public deployment.

## Verified locally

- Fresh migrations 001–016, checksums, prefix checks, transactional rollback and
  concurrent migration runners pass tests.
- Eleven HTTP suites pass with a restricted app login, not a database owner.
  Workflow suite covers 71 checks; the separate AI outage suite also passes.
- SQL tests cover room turnover, quote feedback, AI shadow guards, booking
  workflow and runtime permissions. AI tests: 25 pass.
- Backend builds and npm audit reports zero vulnerabilities at test time. This
  is not a guarantee of no undiscovered vulnerabilities.
- Production startup rejects insecure cookies/HTTP origins and owner-level DB
  access; accepts the restricted runtime configuration. External TLS is untested.
- Logical backup restores into a NEW validation database. Content and row counts
  match for all 27 tables. Reports: .tmp/operations-evidence. No production backup
  was read or certified.

## API handoff to the separate UI agent

All routes below use the /api/v1/core prefix and existing authentication envelope.
Admin routes require the current active admin identity.

| Route | Purpose |
| --- | --- |
| GET/PATCH /admin/booking-policy | Deposit, TTL and checkout settlement policy |
| GET /admin/bookings/:id/financial-status | Immutable terms, balances, credit and lifecycle version |
| POST /admin/bookings/:id/confirm | Confirm an unexpired funded Pending booking |
| POST /admin/bookings/:id/no-show | Audited NoShow after the arrival day |
| POST /admin/bookings/:id/credit-authorization | One-time CheckedIn credit cap |
| GET /admin/workflow/readiness | Expiry worker and backlog |
| POST /admin/workflow/expire | Bounded expiry batch; the worker normally handles this |
| GET /users/me/notifications | Owner-scoped in-app inbox |
| PATCH /users/me/notifications/:id/read | Idempotent owner-scoped read receipt |

Workflow actions require expected_version and a 10–500 character reason;
confirm/no-show/credit require Idempotency-Key. Credit also requires
authorized_amount. Policy changes use expected_version without an idempotency key.
PATCH /admin/bookings/:id/complete now returns 410: it may not invent a completed
stay. Notifications support limit/offset pagination and do not expose internal
actor/reason metadata.

Booking/history/payment/admin projections add Pending, Expired, NoShow,
policy_version, deposit_required, pending_expires_at and lifecycle_version.
CheckedIn does not imply can_check_out: settle the balance or authorize credit.
Credit permits departure, not debt forgiveness; Completed debt is still
collectible and blocks account anonymization.

Default new policy is 0% deposit, full payment at checkout. Existing bookings keep
their original terms. Pending holds inventory only until its DB-clock deadline.
Deposits auto-confirm while still valid. NoShow/Expired currently mean full refund,
no fee. A hotel's different fee rules need an explicit policy design.
Notification is in-app only; no email/SMS delivery is claimed.

NoShow/Expired are not successful-stay labels. Historical Completed records without
audited check-in/out are censored, not rewritten. Validation fixtures must never
be exported as genuine AI observations.

## Open release gates

1. Real AI exposures/outcomes meeting AI-004/005 quality and time gates. Champion
   stays active; conversion challenger has no approved artifact. Do not lower gates.
2. Account email verification/recovery and transaction delivery are unfinished.
   Choose the sender/domain/provider and verification policy.
3. Online payment provider, sandbox credentials, webhook verification and real
   reconciliation are unfinished; existing payments are an audited manual ledger.
4. Approve a hotel acceptance checklist: fee/refund/no-show rules, date changes,
   early departure, invoices/tax and staff responsibilities are not certified by
   the present booking tests.
5. Configure domain/certificates, secret provisioning, network exposure, offsite
   encrypted backups, retention, RPO/RTO and actual alert delivery.
6. Upgrade the unmanaged existing DB only after backup/clone verification of its
   historic migration prefix. Never create an empty ledger to replay old SQL blindly.

## Safe deployment procedure

Provision an environment-specific non-owner LOGIN using the deployment secret
mechanism, then GRANT hotelai_runtime to it. The permission group has NOLOGIN and
no password. Set BACKEND_DB_USER/BACKEND_DB_PASSWORD for the app. Keep POSTGRES_USER
as the separate migration owner; never grant that role to the runtime login.

Set DEPLOYMENT_MODE=production, COOKIE_SECURE=true and explicit HTTPS CORS_ORIGINS.
Startup checks these and rejects destructive/owner DB access. This does not issue
certificates, verify external TLS or turn the development compose topology into HA.

Before an upgrade: stop mutation traffic, take and restore-verify a backup, run
migrate.mjs --apply and --check with the owner, deploy the matching image and
exercise booking/payment/AI health before reopening. Never edit a released
migration. Add the next migration instead.

A failed migration rolls back only that migration and prevents startup. If
rollback needs an older schema, restore a verified snapshot into a NEW database
under an approved recovery plan. No destructive down migration is provided.
External payments require reconciliation beyond database rollback.
