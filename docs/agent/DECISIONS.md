# Decisions

## ADR-001 — Existing production architecture
Use `4_frontend_nextjs` App Router with current framework versions. Figma is visual source only. Reject Vite/React Router migration.

## ADR-002 — Preserve prior work
Keep current dirty branch. Save baseline frontend zip/diff/status in private `.git/agent-checkpoints/2026-09-06-figma/`. Stage only intentional task changes, never all user changes. Existing checkpoint scope was a prior session and does not override current user authorization to modify frontend.

## ADR-003 — Scoped design and one theme
Use `.figma-site` for Figma variables and selectors. Reuse existing theme provider, Fraunces/DM Sans fonts and Tailwind 4. Avoid CSS changes to admin. Preserve original assets under public/images/figma.

## ADR-004 — Separate visual port from API adaptation
First build/test source-derived views with isolated temporary Figma data. Reconnect existing services after the UI gate. Backend IDs, VND currency, inventory and quotes remain authoritative. Do not invent a catalog relationship from matching Figma numeric IDs.

## ADR-005 — Honest capability boundaries
No fake payment collection/confirmation. Backend supports manual payment ledger, not card processing. Destination/editorial marketing content is distinct from room inventory. Only call actual AI endpoints; deterministic assignment must not be described as AI allocation.
