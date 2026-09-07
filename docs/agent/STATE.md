# Current State

Last updated: 2026-09-07
Current branch: v0/hotel-management-dashboard-513c8baf
Latest safe commit: 676e677 chore(agent): record migration architecture and baseline
Current phase: FIGMA_UI_MIGRATION_COMPLETE; backend integration starting
Current task: Reconnect source-derived views to existing backend contracts
Status: IN_PROGRESS

## Repository layout discovered

See MASTER_PLAN.md. Production Next frontend, Figma export, Nest backend, FastAPI AI and Docker infrastructure are present. No previous docs/agent memory existed. Prior execution/AI docs remain intact.

## Completed

- Read user brief, root/current branch/status, frontend and Figma instructions, existing handoff.
- Discovered extensive preexisting uncommitted changes; stayed on original branch, did not discard or stage them.
- Preserved preexisting diff/status and frontend source archive in `.git/agent-checkpoints/2026-09-06-figma/`.
- Read installed Next routing/client boundary/CSS guides.
- Frontend baseline production build PASS (16 existing routes).
- Compared dependencies: no additional runtime packages needed for source Figma UI.

## Currently working on

- Source-derived Home/public shell and Rooms/detail/About/Destinations are ported; Book view is being implemented independently.
- UI gate passed: all six routes render, production build passes (19 routes), browser desktop/mobile navigation, gallery, booking steps, search/list and theme verified. Transactional mocks must now be replaced.
- Local Next dev server at http://127.0.0.1:3100 (exec session 27788).

## Files modified during current task

- Agent docs, `src/components/features/figma/*`, `src/data/figma-mock.ts`, `src/styles/figma.css`, public route wrappers/loading/error, assets.
- Existing `src/app/styles.css` scoped to `.legacy-public` to prevent broad grid/button/form rules breaking source presentation and admin.
- Build can regenerate Next type artifacts; preserve baseline changes.

## Commands successfully run

- `git rev-parse --show-toplevel`, `git status --short`, `git branch --show-current`, `git log -1 --oneline`.
- `npm run build` in `4_frontend_nextjs` (Next 16.3.3; strict TypeScript passes).

## Current errors / blockers

- No frontend baseline build errors. Interim migration builds caught partially-written agent views (Destinations then missing Book); wait for agent completion before next full build.
- Many preexisting modifications/untracked files; do not treat them as changes from this task.
- Figma prototype has fake booking confirmation, taxes/extras/payment card inputs and mock destination/room data. Must not send unsupported fields or claim charges/real inventory.
- No separate AI allocation/occupancy forecasting implementation found. Assignment is deterministic.
- Another backend thread completed migrations 015/016 and booking workflow since discovery; read updated API_MAP before integration. Existing frontend status types lag Pending/Expired/NoShow.

## Important technical observations

- Existing backend already integrated into frontend via services. Preserve auth cookie and booking/quote telemetry behavior.
- Figma uses warm gold/brown dark/light variables distinct from existing admin variables. Scope styles and reuse one ThemeProvider.
- Build scripts are dev/build/start only; no lint/typecheck/test npm scripts. Direct installed TypeScript CLI can supplement build.
- Docker runtime services currently healthy; gateway at http://localhost.

## Next exact actions

1. Create real room presentation adapter; reconnect server routes and remove unsupported mock fees/discounts/reviews/services from transactional UI.
2. Connect BookView via existing useDynamicPrice/createBooking/auth/quote telemetry; show actual Pending/Confirmed/deposit terms. Preserve other existing pages.
3. Add same-origin Next core API boundary with server-only backend target and origin checks, then update lifecycle fields/status handling.
4. Use isolated operations validation stack (never restart default live stack) for mutation tests. `docs/execution-checkpoint.md` has current backend test setup.

## Resume instruction

Read this file plus TASKS/DECISIONS/API_MAP and review `git status`. Compare the pre-session snapshot in `.git/agent-checkpoints/2026-09-06-figma/` before attributing changes. Continue the numbered actions; never reset the dirty worktree or replace Next with the Figma Vite project. Update this file at every milestone.
