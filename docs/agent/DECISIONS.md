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

## ADR-006 — Shared reservation and safe retries
Both source-derived Book and existing Checkout use useReservation over existing
quote/auth/booking/telemetry services. Expose only a quote matching the entire
current input. Ignore aborted/out-of-order responses. Reuse `booking:<quote_id>`
for creation and recovery. After a potentially committed request loses its
response, lock input/refresh and retry the same request, including after expiry.
An exposure failure before creation does not claim an ambiguous booking.
Display actual backend status and policy/payment snapshots rather than assuming
confirmation, free cancellation or a completed payment.

## ADR-007 — Same-origin native frontend boundary
Use a narrow Next core proxy for native development and server rendering.
Keep the configured target private; preserve cookie/idempotency headers and
validate origin/path/body/timeout behavior. Existing production Nginx routing
continues to reach Nest directly. Do not trust browser forwarding headers.
Native clients share core's upstream-IP auth throttle; see RUNBOOK.md for the
public origin configuration needed by another HTTPS reverse proxy.

## ADR-008 — Truthful session termination
Await core logout confirmation before clearing client state or navigating.
Keep the session and show a retry message after failed logout. Clear local
state directly only when core has already reported revocation or completed
password/deactivation actions. Guard pending session fetches from restoring
older state after an authentication transition.

## ADR-009 — Integration checkpoint scope and verification limits

Preserve the original dirty workspace. The final checkpoint uses the explicit
frontend task manifest, environment example, deleted transactional mock, agent
documentation and the one touched booking service. Some touched files already
contained substantial work before this migration; their contents are retained,
not attributed entirely to this task. Unrelated remaining changes are not staged.
A private final frontend source archive accompanies the baseline archive. A
fresh clone of the migration commits alone is not the full existing workspace;
preserve the remaining backend/AI/infrastructure work for reproducibility.

Final browser verification distinguishes visible outcomes from API coverage.
Reservation creation/history, quote expiry/refresh, mobile width and real AI
outage/recovery were observed. The in-app browser stalled at the existing native
cancellation confirmation and did not expose a dismissible dialog. Cancellation,
profile update and logout have passing API/unit coverage; their remaining final
browser interactions are documented as a tool limitation, not claimed as passed.
