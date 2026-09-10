# Phase 0 — Discovery
- [x] Locate Next, Figma, backend, AI, infrastructure and Git root.
- [x] Read existing checkpoint and preserve dirty worktree.
- [x] Create persistent agent memory and private frontend backup.
- [x] Complete API/AI contract map, including newer 015/016 workflow.

# Phase 1 — Baseline
- [x] Next production build passes.
- [x] Backend build and AI baseline tests (25 AI tests passed with workspace temp workaround).
- [x] Discovery checkpoint commit (676e677).

# Phases 2–7 — Foundation
- [x] Compare dependencies (no additions required).
- [x] Copy Figma assets, preserve filenames (9 PNGs).
- [x] Scope Figma styles and reuse existing theme.
- [x] Port public shell/navigation/footer with Next links.

# Phase 8 — Source presentation
- [x] Home migrated and verified.
- [x] Rooms migrated and verified.
- [x] Room Detail migrated and verified.
- [x] Book migrated and verified (honest preview; real integration next).
- [x] About migrated and verified.
- [x] Destinations migrated and verified.
- [x] Desktop/mobile/theme/interaction/image checks.
- [x] Production build and FIGMA_UI_MIGRATION_COMPLETE checkpoint.

# Phases 9–13 — Real integration
- [x] Rooms list/detail use backend adapters; boundary/SSR/invalid-room checks pass.
- [x] Booking uses existing quote/auth/booking API; live HTTP replay/cancel tests pass.
- [x] Authentication/profile/history preserved; unit and live HTTP checks pass.
- [x] Relevant hotel management preserved; lifecycle UI unit and backend admin suites pass.
- [x] Pricing and unavailable handling verified through backend/AI and real-hook tests.
- [x] Determine allocation/forecast support; document actual capability.

# Final verification
- [x] Production build and unit/backend/Next HTTP integration tests pass.
- [x] Final browser booking/history/profile-read/mobile width and AI-outage/recovery checks.
- [ ] Manual browser cancellation/profile-save/logout: IAB native confirmation stalled; API/unit coverage passed (see TEST_LOG).
- [x] Remove transactional mocks, misleading unsupported payment/extra claims.
- [x] Review secrets/environment and Git status.
- [x] Update runbook, all memory files, completion report and final integration checkpoint 1c1bcd4.
