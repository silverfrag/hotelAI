# Test log

## 2026-09-06 — Baseline before migration

- `4_frontend_nextjs: npm run build` — PASS. Next 16.3.3 Turbopack, TypeScript, 16 routes generated. No build warnings/errors reported. Existing dependencies already installed; npm lockfile present.
- No frontend lint/typecheck/test scripts exist; do not invent npm commands or disable checks.
- Backend `npm run build` PASS; AI pytest 25 PASS with workspace basetemp and cache disabled after Windows temp/cache ACL errors. 16 NumPy/joblib deprecation warnings; no source changes needed.
- Git baseline is extensively dirty; preexisting diff/status and frontend source snapshot preserved privately under `.git/agent-checkpoints/2026-09-06-figma/`.

## 2026-09-07 — Migration work in progress

- Discovery checkpoint 676e677 committed agent docs only.
- Room/detail and editorial agent targeted TypeScript checks PASS during their work.
- Interim production build failed while Destinations was partially copied, then while BookView was not created yet. These are work-in-progress sequencing failures; do not weaken checks. Run next full build after all agents finish.
- A build mistakenly invoked at workspace root reported missing package.json; corrected working directory to 4_frontend_nextjs.
- Next dev server ready at 127.0.0.1:3100; visual gate pending.

### FIGMA_UI_MIGRATION_COMPLETE

- `npm run build` PASS: all 19 routes, strict TypeScript, no ignored errors.
- CUA browser: Home/Rooms/detail/Book/About/Destinations render. Compared source markup/styles and inspected desktop Home/Rooms plus mobile About/destinations/booking.
- Detail photo selection changes displayed image; modal opens at selected photo and Escape closes it.
- Book Continue reaches room and guest steps; date/guest inputs are accessible.
- At 390×844 mobile viewport, menu opens/closes on navigation; About and destination layout fit. Measured document width 382 <= viewport 390.
- Destination q=Bali produces one result; grid/list switching and dark/light theme work. No broken loaded images.
- Image HTTP audit: 45/46 URLs valid; source About portrait 404 replaced with verified matching-size portrait. Original source retained.
- This gate verifies source presentation, not real booking/payment or backend domain integration.

## 2026-09-08/09 — Real integration and boundary verification

- Production integration build PASS: 19 routes, strict TypeScript. This preceded
  the final logout and price-sidebar edits; final rebuild remains necessary.
- Direct installed TypeScript CLI PASS after room-response validation and sidebar
  consistency/auth-return changes.
- `node --test scripts/core-boundary.test.cjs` PASS: 7 grouped behavioral tests
  of real route-handler code with controlled upstream responses. Covered unsafe
  origins, localhost/HTTPS origin configuration, cookie/idempotency forwarding,
  untrusted forwarding-header removal, invalid paths, declared/chunked 1MiB
  bounds, stalled-body cancellation, safe outage/redirect errors and HEAD.
  The first harness attempt used removed TypeScript 7 transpile APIs; switched
  to the already installed Next SWC compiler. No dependencies were added.
- Lifecycle SSR/service/history-hook unit checks passed at 64 assertions;
  durable script is `scripts/lifecycle-unit-check.cjs`. These are mocked-unit
  checks, not evidence of real API transactions. Final auth/reservation checks
  are still in progress.
- Live frontend smoke is prepared but NOT RUN. Docker startup failed on stale
  runtime sockets, and automatic approval review rejected Next53100 startup
  with a generic "blocked by policy" response. Preserve these limits when
  reporting completion. Socket repair evidence remains under .tmp/docker-repair.

### 2026-09-09 — Runtime blockers resolved and live integration verified

- Docker /_ping200, Engine29.7.2; only stale socket parent directories renamed
  aside. Default live project not modified. Isolated compose build hit a
  transient registry DNS error; retry succeeded with healthy validation services.
- Eight backend suites PASS in `hotel_validation_run_92a96b19c711`: booking,
  user accounts, payment/refund replay, admin controls, admin operations,
  booking workflow (71 checks), API contracts and AI outage. AI-enabled outage
  503/no partial booking, intentional AI-disabled base pricing works. AI restored.
- Real frontend smoke initially revealed first-create `deposit_required` as a
  PostgreSQL decimal string. Backend response now normalizes it to a number,
  matching replay/history. Backend rebuild and booking smoke PASS against fresh
  restricted database `hotel_validation_run_505544579e90`.
- Next production build PASS (19 routes) after inline recovery sign-in, safe
  auth redirects and booking payload guards. Restricted build could not fetch
  Google Fonts; approved network retry passed without font/dependency changes.
- Final unit scripts PASS: core-boundary (8 groups), lifecycle, auth-session,
  reservation-hooks, booking-service and auth-recovery. Tested actual modules
  against controlled API responses/time, including malformed201 and ambiguous
  creation followed by401/403/409/429, same-account recovery, and redirect attacks.
- `node scripts/integration-smoke.mjs --isolated-stack-ready` PASS: 15 live groups
  through built Next53100/core53002. Evidence:
  `.tmp/frontend-smoke/2026-09-09T10-40-48-347Z-9ada4990.json`.
  Covers SSR real catalog, cookies, origin/body/path bounds, profile version
  conflict, AI lineage, quote exposure, numeric deposit, same-key booking replay,
  changed-input rejection, ledger view, cancellation and logout/login.
- Corrected the test's invalid-room HTTP assumption: installed Next documents
  streamed notFound responses as200 with noindex. Smoke checks the streamed
  missing-page payload; CUA confirmed the rendered404 page.
- Final browser checks in progress. Prior synthetic registrations reached the
  intended3/10min limit; UI displayed the error. Only isolated backend restarted
  to begin the browser fixture, without changing production limits.

### 2026-09-10 — Final browser verification and handoff

- Reused the synthetic account registered in the earlier browser session. The
  mounted quote had expired overnight; Confirm Reservation was disabled.
  Refresh price obtained a new AI quote: 1,152,000 VND/night, 2,304,000 VND total.
- Browser creation PASS: reference `a7b19993-5de8-403d-952f-39000b7e3da8`,
  room 101 / Deluxe King, 2026-11-12 to 2026-11-14, Confirmed and Unpaid.
  My bookings rendered the same reference, dates, nightly/total price, zero
  collected and 2,304,000 VND due. This is isolated synthetic data, not a guest stay.
- Profile read PASS for the same authenticated account. Profile-save outcome
  was not verified: the in-app browser became unresponsive to clicks after the
  earlier native cancellation confirmation. Its documented dialog API returned
  no dialog; screenshot, dismissal and close attempts also failed. Browser
  cancellation/profile-save/logout are NOT counted as passed. Their real API
  and unit tests passed on September 9; this is a remaining manual browser check.
- AI outage UI PASS: stopped only validation `ai_service`, opened Book with new
  dates and observed the explicit unavailable-price alert. The sidebar labeled
  its base estimate separately and did not claim an AI quote. At 390x844, document
  width was 382px, with no horizontal overflow. Earlier menu/theme/gallery and
  six-page presentation checks remain recorded above.
- AI restored with compose.test.yml `start ai_service`. AI health, backend
  readiness and Next health all returned200. Reloaded Book displayed AI quote
  and final total2,383,200 VND for November16–18. Viewport override reset.
- Final source review PASS: explicit57 frontend manifest paths plus environment
  example/backend/docs reviewed; no real secrets or generated junk detected.
  Independent baseline ZIP comparison found no omitted task-owned source files;
  nine reference PNGs were already committed. Deliberate unit-test credentials
  are fake fixtures. Unrelated preexisting dirty files remain untouched by staging.
- No application code changed after the passing final production build and unit
  checks. Full handoff and reproducible commands are in COMPLETION_REPORT.md and
  RUNBOOK.md. The final Git checkpoint is recorded in STATE.md.
