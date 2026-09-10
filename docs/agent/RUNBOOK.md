# Frontend migration runbook

## Architecture and boundaries

`4_frontend_nextjs` remains the Next.js App Router frontend. `Source Figma Make`
is the preserved visual reference; its Vite and React Router infrastructure is
not used by production. The six public views retain the source layout, warm
gold palette, typography, photography, responsive navigation and interactions.
Existing account and hotel management views remain available.

Public server pages read the core room catalog. Browser requests use
`/api/v1/core`; Next forwards native requests to `BACKEND_API_URL`. The existing
Docker Nginx gateway routes that prefix directly to Nest. Nest owns PostgreSQL
transactions, cookie sessions, quote snapshots, payment ledger and room
assignment, and calls the private FastAPI pricing service. Browser code does
not call AI endpoints or receive private AI configuration.

The Next proxy checks unsafe request origins, limits request bodies to 1 MiB,
uses a 15-second timeout and preserves cookie/idempotency headers. It does not
trust browser-supplied forwarding headers. Native clients share the backend
authentication throttle bucket because the proxy is their common upstream IP.
The existing Nginx path retains its client identity handling. For a different
TLS reverse proxy, set `FRONTEND_ORIGIN` to the exact public HTTPS origin.

## Local frontend against an existing backend

Use the existing Node/npm installation compatible with the lockfile (Docker
uses Node 24). In PowerShell:

```powershell
Set-Location E:\hotelAI\4_frontend_nextjs
npm ci
$env:BACKEND_API_URL = 'http://127.0.0.1:3000/api/v1/core'
$env:NEXT_PUBLIC_API_URL = '/api/v1/core'
npm run dev -- --port 3100
```

Use `http://localhost/api/v1/core` as the private target when reading an already
running Docker gateway. The example environment file is
`4_frontend_nextjs/.env.local.example`; no credentials belong in public variables.
Frontend and backend must use different ports. Production frontend commands:

```powershell
npm run build
npm run start -- --port 3100
```

`NEXT_PUBLIC_API_URL` is compiled into browser code; rebuild when changing it.
Set the private `BACKEND_API_URL` when starting the server as well as during
local build verification. No new runtime dependencies were needed for the port.

## Isolated backend and AI validation

The existing live stack may contain user data and unmanaged migration history.
Do not apply migrations to it blindly. The validation compose project uses
separate loopback ports and volumes and deliberately disposable credentials.
From `E:\hotelAI`:

```powershell
docker compose -f 1_infrastructure/operations/compose.test.yml up --build -d --wait
node 1_infrastructure/operations/run-validation.mjs smoke-test user-accounts-smoke-test booking-workflow-smoke-test api-contract-smoke-test ai-outage-smoke-test
```

The runner creates a fresh randomly named database, applies migrations, uses
the restricted runtime role, and retains evidence. It starts the Nest backend
at `http://127.0.0.1:53002/api/v1/core` and FastAPI AI at
`http://127.0.0.1:58000`. Backend inference travels over the private Docker
network. Do not reuse validation credentials for deployment or synthetic data
for AI training. See `1_infrastructure/operations/README.md` for migration,
backup/restore and production release procedures.

For frontend validation, use the same environment commands above with private
target `http://127.0.0.1:53002/api/v1/core`, build, then start on port **53100**.
Keep the restricted scratch backend running during the frontend smoke test.
Stop only this validation project when finished:

```powershell
docker compose -f 1_infrastructure/operations/compose.test.yml stop
```

## Product behavior and remaining content limits

- Room IDs, names, capacity, VND base rates and inventory come from core. Quotes
  supply the nightly and total amount and availability for selected dates.
- Both booking forms use one reservation hook: quote exposure, expiry, cookie
  authentication, stable idempotency key and authoritative result. Ambiguous
  submission failures lock the selection for recovery of the same request.
  Recovery survives further session/rate-limit errors in the open form and
  supports inline sign-in by the original account. It is not persisted across
  reload or navigation: keep the form open and inspect My bookings in another
  tab before starting another reservation.
- Receipts/history support Pending, Confirmed, CheckedIn, Completed, Canceled,
  Expired and NoShow. Deposit amount/deadline and payment eligibility come from
  the backend policy snapshot. Payments are recorded by hotel staff; no online
  card gateway is configured.
- AI pricing uses the existing champion through core. An enabled but unavailable
  AI service produces an error; the UI does not invent a fallback AI price.
  Intentional AI-disabled base pricing is labeled as base pricing.
- Room assignment is deterministic transactional allocation. No separate AI
  allocation or occupancy forecast endpoint exists. Shadow conversion controls
  retain their existing data/readiness gates and are not presented as live AI.
- Destinations are editorial inspiration, and room photographs are illustrative.
  Core has no gallery, amenities, property location, reviews or paid extras
  contract. These are not fabricated as room facts or sent in booking payloads.
- Social/legal footer labels have no configured destination. No email/SMS,
  password reset, online card processing, or unimplemented AI feature is claimed.
- The original Figma export and nine copied reference assets are preserved.
  The temporary transactional Figma mock module has been removed.

## Evidence and checkpoints

`TEST_LOG.md` records completed checks and their limits; `STATE.md` holds the
current resume point. The workspace already contained extensive uncommitted
backend/AI/frontend work before migration. Task commits intentionally do not
sweep that work into a commit. A private baseline source archive, Git diff and
status are retained under `.git/agent-checkpoints/2026-09-06-figma/`.
Use the current workspace or preserve its remaining changes before expecting
a fresh clone of only the migration checkpoints to reproduce the full app.
The integration checkpoint is `1c1bcd4`; a final 124-file frontend source archive
and the touched backend service are saved beside the baseline. The explicit
checkpoint contains preserved earlier code inside touched files, while unrelated
remaining backend/AI/infrastructure work was not staged. The completed report
and final manual browser-verification limits are in `COMPLETION_REPORT.md`.

From `4_frontend_nextjs`, the repeatable frontend verification commands are:

```powershell
node --test scripts/core-boundary.test.cjs
node scripts/lifecycle-unit-check.cjs
node scripts/auth-session-unit-check.cjs
node scripts/reservation-hooks-unit-check.cjs
node scripts/booking-service-unit-check.cjs
node scripts/auth-recovery-unit-check.cjs
node scripts/integration-smoke.mjs --isolated-stack-ready
```

The first six scripts run real modules against controlled responses and time;
they make no real API writes. The final script requires the verified isolated
stack and running Next53100, uses synthetic records, and saves sanitized HTTP
evidence to `.tmp/frontend-smoke`. It refuses other ports or missing explicit
test acknowledgment. Expect registration throttling after repeated runs;
fresh validation fixtures must not be treated as real guests or training data.

The build downloads DM Sans and Fraunces through `next/font/google`. Network
access to Google Fonts is required at build time; fonts are then served by
Next. No framework downgrade or disabled type check is used for offline builds.
