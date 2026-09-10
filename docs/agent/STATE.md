# Current State

Last updated: 2026-09-10
Current branch: v0/hotel-management-dashboard-513c8baf
Latest safe commit: 76523f9 feat(frontend): migrate Figma public experience to App Router
Current phase: Implementation and verification complete; final checkpoint
Status: CHECKPOINT_PENDING

## Scope and architecture

The master brief is the Figma Make to existing Next.js, backend and AI migration.
Next remains in `4_frontend_nextjs`; `Source Figma Make` is preserved. Six public
views use the source visual design. Existing account/admin functionality remains.
Nest in `3_backend_core` owns bookings, auth, PostgreSQL, payments and policy.
FastAPI in `2_ai_pricing_service` supplies pricing through Nest only. See
MASTER_PLAN.md, API_MAP.md, DECISIONS.md and COMPLETION_REPORT.md for detail.

## Completed

- Six public views migrated and presentation verified on desktop/mobile. Scoped
  CSS and shared theme protect existing UI.
- Real room catalog and validated adapters replace transactional mocks. Dates,
  availability, quotes, booking results and lifecycle/payment eligibility come
  from core. Editorial destinations and illustrative photos are labeled.
- Shared reservation hook serves Book and Checkout: quote exposure, stale-response
  guards, expiry, stable idempotency key and same-account inline recovery after
  ambiguous submissions. Recovery lasts in the mounted form only.
- Narrow Next core proxy validates origin/path/body/timeouts; private config stays
  server-only. Existing deployment Nginx routes core directly to Nest.
- Seven booking states and current payment eligibility represented in receipts,
  history/admin. Safe auth return and confirmed-logout behavior fixed.
- One backend response fix normalizes first-create deposit_required to a number,
  matching replay/history. No schema or pricing policy change introduced here.
- Final production build PASS: 19 routes and strict TypeScript. Six durable
  frontend unit/boundary scripts PASS. Eight isolated backend suites PASS.
  AI baseline pytest25 PASS. Live Next-to-core HTTP integration15 groups PASS.
- Final browser PASS: authenticated booking, real receipt/history, expired-quote
  lock/refresh, profile read, mobile width and real AI outage/recovery.
- Source/secrets/junk and baseline comparison reviewed. No new dependencies.

## Verification limitations

The in-app browser stalled at the existing native cancellation confirmation.
It returned no accessible JavaScript dialog; dismissal/close/screenshot failed.
Profile-save and logout interactions after this are not claimed as browser PASS.
Cancellation, profile update and logout passed real HTTP and unit checks. A
manual browser check of those interactions remains; no product defect was
established by the tool failure. Earlier mobile menu/theme/gallery UI gate passed.

## Runtime and evidence

- Next production preview: http://127.0.0.1:53100, hidden background node originally
  PID17448 (verify current process ownership before stopping). Private core target
  http://127.0.0.1:53002/api/v1/core. Logs are
  `.tmp/next-test-20260909-final.stdout.log` and `.stderr.log`.
- Isolated compose: `1_infrastructure/operations/compose.test.yml`, project
  hotelai-ops-validation. Current database hotel_validation_run_505544579e90,
  restricted hotel_validation_app role. All16 migrations applied; previous test
  databases retained. Never run mutation suites against the default live stack.
- Final Next/core/AI health200. Validation AI was stopped for outage testing and
  restored; fresh browser AI quote observed. Viewport override reset.
- Synthetic browser booking: a7b19993-5de8-403d-952f-39000b7e3da8, November12-14,2026,
  room101, Confirmed/Unpaid, total2,304,000VND. Not a real guest stay.
- HTTP evidence: `.tmp/frontend-smoke/2026-09-09T10-40-48-347Z-9ada4990.json`.
  Generated `.tmp` evidence is retained locally, not staged.
- Docker startup failures resolved by preserving only stale socket parent dirs.
  Latest backups: run.stale-20260909-225002 and
  docker-secrets-engine.stale-20260909-225002; evidence `.tmp/docker-repair`.
  No WSL disks, volumes, settings or ACL reset. Existing validation containers
  started without recreation; current scratch DB retained.
- Earlier Next startup approval rejection resolved under updated permissions.
  Font build needed network access. Neither is a current application blocker.

## Preservation and checkpoint rules

There was extensive dirty backend/AI/frontend/infrastructure work at task start.
Do not reset/clean or stage everything. Baseline diff/status/frontend ZIP:
`.git/agent-checkpoints/2026-09-06-figma/`. Prior commits: discovery676e677,
Figma UI76523f9. Final explicit task list: `.tmp/frontend-task-files.txt`, plus
.env.local.example, deleted figma-mock module, agent docs and touched booking
service. Some touched files include preserved earlier work. Unrelated changes
remain uncommitted; a fresh clone of migration commits alone does not contain
this entire app. See RUNBOOK.md for startup and preservation instructions.

## Known product limits

No online card gateway, AI room allocation or occupancy forecast API exists.
Assignment is deterministic and transactional. Shadow AI retains readiness gates.
Core has no gallery/amenities/reviews/destination or paid-extra contract. Footer
social/legal targets are unconfigured. Ambiguous booking recovery is not persisted
across reload/navigation; the UI explains keeping the form open. Build downloads
existing Google Fonts. No production deployment was performed.

## Next exact actions

1. Create final explicit source checkpoint and record its hash here.
2. On resume, read STATE, TEST_LOG and RUNBOOK and verify runtime health. Only
   outstanding verification: manual browser cancellation/profile-save/logout
   after closing the stuck in-app browser session. Do not repeat all mutation
   suites or alter the live database for this.
3. Additional content/provider/AI features or production release need their real
   configuration and existing release procedure; do not fabricate them.
