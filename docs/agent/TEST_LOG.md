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
