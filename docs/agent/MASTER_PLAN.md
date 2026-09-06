# HotelAI master plan

## Architecture discovered 2026-09-06

- Git/workspace root: `E:/hotelAI`; branch `v0/hotel-management-dashboard-513c8baf`.
- Production frontend: `4_frontend_nextjs`, Next.js 16.3.3 App Router, React 19.2.8, strict TypeScript 7, Tailwind 4; npm lockfile. Installed Next guides are under `node_modules/next/dist/docs`.
- Figma reference: `Source Figma Make`, React/Vite, React Router, Tailwind 4; six pages, shared Layout, ThemeContext, static data and nine PNGs. Preserve reference unchanged.
- Backend: `3_backend_core`, NestJS, TypeORM/PostgreSQL, JWT + HttpOnly session cookie, room catalog, price quotes, bookings, user accounts, payments and admin operations.
- AI: `2_ai_pricing_service`, FastAPI/Pydantic/scikit-learn champion pricing and conversion/shadow pipeline. Check real contracts before adding UI. Deterministic room assignment is not AI allocation.
- Infrastructure: `1_infrastructure` PostgreSQL schema + 014 migrations, Nginx gateway; root Docker Compose with PostgreSQL, Redis, Kafka, backend, AI and frontend.
- Environment files exist at root and backend; frontend has `.env.local.example`. Never log/commit actual secrets.
- Prior work documented in `docs/execution-checkpoint.md`, `docs/ai-first-roadmap.md` and related docs. User's current Figma migration brief supersedes the older session's no-frontend-change scope.

## Phases

1. Discover, preserve preexisting work, baseline checks, persistent handoff.
2. Port Figma assets/tokens, reuse existing theme, migrate public shell in `(public)`.
3. Port Home, Rooms, Room Detail, Book, About, Destinations; isolate temporary mocks and preserve exact source structure/styles where practical.
4. Verify all six pages, links, images, responsive behavior and production build. Record FIGMA_UI_MIGRATION_COMPLETE gate before reconnecting APIs.
5. Reuse authoritative services; adapt real room IDs/names/capacities/VND prices, quotes and booking. Preserve auth/profile/history/admin functionality.
6. Verify actual AI pricing and unavailable behavior. Integrate only allocation/forecast capabilities supported by discovered code.
7. Production build, browser journey, relevant backend/AI tests, documentation and safe checkpoint.

## Strategies

- No Next/React/TypeScript downgrade, no Vite infrastructure or React Router in production. Existing UI dependency set is sufficient for Figma (inline SVGs, React, Tailwind).
- Assets: `4_frontend_nextjs/public/images/figma/`, original filenames; retain original remote photography where used in reference, verify availability.
- Public design tokens scoped to `.figma-site`; preserve admin styles. Existing ThemeProvider remains sole theme authority.
- Existing App Router `(public)` stays; add `/book`, `/about`, `/destinations`; preserve `/checkout`, `/bookings`, `/login`, `/register`, `/profile`, `/admin/**`.
- Server route wrappers own data fetching and async route params; interactive source-derived views are client components.
- Keep `src/services/` authoritative and backend contracts unchanged. Use frontend adapters, safe errors and loading/empty states. Browser talks only to backend-facing API; AI private host stays server-side.
- Figma fake payments, static taxes, testimonials and destination inventory must not masquerade as real backend capabilities. Preserve presentation while accurately explaining unsupported operations.
- Do not stage existing user work wholesale. Initial checkpoint commits only new agent docs; preserve a private pre-change frontend archive and binary diff in `.git/agent-checkpoints/2026-09-06-figma/`.
