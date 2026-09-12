# Current State

Last updated: 2026-09-12
Current branch: v0/hotel-management-dashboard-513c8baf
Latest implementation checkpoint: feat(hotel-ai): expand 98-room inventory, smart allocation, ai upgrade engine & housekeeping dispatcher
Current phase: Production-ready baseline commit & future roadmap deduction
Status: READY_FOR_GIT_PUSH_AND_ROADMAP

## Latest milestone — 2026-09-12 (Base Release)

1. **98-Room Physical Inventory Expansion**:
   - Expanded PostgreSQL seed and live database from 7 rooms to 98 physical rooms across 8 luxury room types (Deluxe King, Twin, Family Suite, Ocean Suite, Sunrise Suite, Spa Villas, Penthouse, Presidential Villa).
   - Flushed and synchronized Redis caches; verified catalog and inventory integrity across frontend & backend.

2. **Smart Contiguity & Turnover Room Allocation Engine**:
   - Upgraded allocation in `3_backend_core/src/modules/bookings/bookings.service.ts` from naive `ORDER BY room_number ASC` to interval bin-packing (+60 pts dual-edge contiguity, +35 pts single-edge, +30 pts Ready status, deterministic tie-breaker).

3. **AI Conversion Model Retraining (Challenger v1)**:
   - Exported 3,034 quotes across the 98-room distribution.
   - Retrained `conversion_challenger_v1.pkl` (`ROC AUC = 0.7157`, `log_loss_improvement = +0.0631`, passing performance & readiness gates).

4. **Smart Room Upgrade & Rebalancing Engine**:
   - Added DB migration `016_smart_room_upgrades.sql` with controlled bypass flag `hotelai.allow_room_upgrade = 'on'`.
   - Built upgrade evaluation algorithms and transactional execution in `admin-room-turnover.service.ts` and `admin-room-turnover.controller.ts`.

5. **Housekeeping Dispatcher Operations Dashboard**:
   - Implemented `4_frontend_nextjs/src/app/admin/housekeeping/page.tsx` & `HousekeepingOperationsManager.tsx`.
   - Integrated AI-driven upgrade recommendations, one-click upgrade execution, room cleaning status updates, and dispatch inspection.

6. **End-to-End Validation**:
   - Next.js production build cleanly compiled (20/20 routes).
   - Smoke tests (`test:public-journey-smoke` & `test:api-contract-smoke`) passed 100%.


User reported authentication UI inconsistent with the public design and asked
where AI appears, how it works and what to learn/train next. Login/register now
use a dedicated CSS module with Aurum tokens/fonts, editorial split layout,
mobile layout and Vietnamese labels. They no longer inherit legacy-public CSS.
Password visibility and accessible pending/error states are retained; switching
login/register preserves the validated return-to-booking URL. Existing auth API
and cookie/session behavior remain unchanged. Metadata uses Aurum branding.

Admin Pricing copy now describes historical-price prediction and actual v2
inputs. It no longer claims revenue optimization or use of special requests;
the switch affects new quotes, preserving valid quotes and stored booking prices.
This file was preexisting/untracked; its earlier implementation is preserved.

AI_PRODUCT_AND_TRAINING.md contains the source-backed Vietnamese walkthrough,
model/data metrics, missing capabilities, next dataset/evaluation work and a
learning roadmap. No new model training or artifact replacement was performed.

Validation: final Next production build PASS,19 routes/strict TypeScript;
auth-recovery and auth-session scripts PASS. Built login/register HTML confirms
Aurum, Vietnamese page language, scoped CSS, password fields and no legacy
wrapper. This is structural verification, not visual browser verification.

Preview runtime changed: old PID17448 is no longer running and port53100 is down.
The user closed browser windows after the earlier modal stall, but CUA inventory
still reports old tabs2/3. Automatic approval review rejected both hidden
Start-Process and foreground npm start on loopback53100 with only "blocked by
policy". Do not repeat alternate startup mechanisms to bypass this rejection.
A user-input request supplies the exact startup commands and asks the user to
start the preview. Once running, open a fresh localhost login/register tab (the
127.0.0.1 synthetic cookie may still be signed in), then verify desktop/mobile,
theme, password visibility, errors and auth-mode return URL. Never use real guest
credentials or run mutation tests against the default live stack.

The runtime bullets later in this file describe the preceding migration session;
the preview status immediately above supersedes them. Training is a proposed
next phase, not an automatically started task.

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

Final integration checkpoint 1c1bcd4 contains 61 intentional changed paths.
Final private frontend archive: frontend-final-20260910.zip, 124 files,
SHA256 5C16BFDFDF6914EC63285C7F59B3EE013E757BB13BD1B97B7D888460FB471891.
The touched backend service and precommit status are saved beside it. The
containing documentation handoff commit records this checkpoint and the remaining
manual verification; use git log -1 for its own hash.

## Known product limits

No online card gateway, AI room allocation or occupancy forecast API exists.
Assignment is deterministic and transactional. Shadow AI retains readiness gates.
Core has no gallery/amenities/reviews/destination or paid-extra contract. Footer
social/legal targets are unconfigured. Ambiguous booking recovery is not persisted
across reload/navigation; the UI explains keeping the form open. Build downloads
existing Google Fonts. No production deployment was performed.

## Next exact actions

1. On resume, read STATE, TEST_LOG and RUNBOOK and verify runtime health. Only
   outstanding verification: manual browser cancellation/profile-save/logout
   after closing the stuck in-app browser session. Do not repeat all mutation
   suites or alter the live database for this.
2. Additional content/provider/AI features or production release need their real
   configuration and existing release procedure; do not fabricate them.
