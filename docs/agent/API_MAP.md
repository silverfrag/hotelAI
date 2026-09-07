# API integration map

Last inspected: 2026-09-07. Includes newer booking workflow (migration 015) and runtime permissions (016). Existing frontend services remain authoritative. Integration statuses below describe source code, not proof that the Figma migration is connected.

## Runtime and common contracts

- Backend: `3_backend_core`, NestJS 11, TypeORM, PostgreSQL. Entrypoints `src/main.ts`, `src/app.module.ts`; global prefix `/api/v1/core`.
- AI: `2_ai_pricing_service`, FastAPI, scikit-learn/joblib. Entrypoint `app.main:app`; pricing champion `random_forest_v2`, feature contract `2.0.0`.
- Docker gateway `http://localhost`; core API `http://localhost/api/v1/core`; backend internal `http://backend_core:3000/api/v1/core`; AI internal `http://ai_service:8000`.
- Browser uses `NEXT_PUBLIC_API_URL` via `services/axiosClient.ts` (a URL constant). Server room service uses `BACKEND_API_URL`, then `NEXT_PUBLIC_API_URL`. Existing fallback uses port 3000; native dev needs deliberate non-conflicting ports. Never expose private AI URLs/secrets in public variables.
- Source Nginx still proxies `/api/v1/ai/*` publicly. Current frontend only consumes core. Closing this alias needs coordination with operational smoke scripts/README; do not connect new UI directly to it.
- Typical success: `{status:'success',data:T,request_id}`. Lists often add `count`. Auth success and auth/me differ (below). Response interceptor adds request ID while preserving endpoint shapes.
- Errors: `{status:'error',statusCode,error,message:string|string[],path,timestamp,request_id}`. `X-Request-ID` header is returned. `core-api.ts` normalizes into `CoreApiError`; domain errors preserve status/tracing. Global validation rejects unknown request keys.
- Dates: strict `YYYY-MM-DD`, check-in inclusive, check-out exclusive. Business date uses `HOTEL_TIMEZONE` (default `Asia/Bangkok`). Timestamp HTTP fields are ISO strings. Reject past check-in and checkout <= check-in.
- Money: numeric VND rounded to two decimal places. No FX, Figma USD pricing, 12% tax, service-fee or paid-extra contract exists. Use returned nightly/total prices.
- Room/type IDs: positive database integer <= 2,147,483,647. Booking/customer/quote/notification IDs: UUIDs. Admin lists generally accept `limit` 1..100 (default 20), `offset` 0..1,000,000 (default 0), return `{status,count,total,limit,offset,data,request_id}`. Public rooms/history are not paginated.

## Feature inventory

Paths are relative to `/api/v1/core` unless explicitly AI-internal.

| Feature | Existing frontend service/UI | Backend endpoints | Integration state |
|---|---|---|---|
| Room catalog/detail | `room.service.ts`, `/rooms`, `/rooms/[id]` | `GET /rooms`, `/rooms/:typeId` | Existing; Figma adapter pending |
| Date-specific AI quote | `booking.service.ts:getPriceQuote`, `useDynamicPrice`, checkout | `POST /pricing/quote` | Preserve after UI gate |
| Quote exposure/rejection | `recordQuoteEvent`, `quote-telemetry.ts` | `POST /pricing/quotes/:quoteId/events` | Preserve confirmed exposure/stable IDs |
| Create booking | `createBooking`, `CheckoutForm` | `POST /bookings` | Existing; success must handle Pending/Confirmed |
| History/cancel | `getBookings`, `cancelBooking`, `BookingHistory` | `GET /bookings`, `PATCH /bookings/:bookingId/cancel` | Existing; frontend types lag migration 015 |
| Payment history | `getBookingPayment` | `GET /bookings/:bookingId/payment` | Existing ledger; no online card gateway |
| Authentication | `auth.service.ts`, `useAuth`, `/login`, `/register` | `POST /auth/register`, `/login`, `/logout`; `GET /auth/me` | Real cookie session; reuse |
| Customer account | `user.service.ts`, `/profile` | `GET/PATCH /users/me`; `PATCH /users/me/password`; `POST /users/me/deactivate` | Existing |
| Notifications | No frontend method found | `GET /users/me/notifications`; `PATCH /users/me/notifications/:notificationId/read` | New backend; UI pending |
| Hotel operations | `admin.service.ts`, `/admin`, `/admin/bookings` | `GET /admin/dashboard`, `/admin/bookings`; `PATCH /admin/bookings/:bookingId/check-in`, `/check-out`, `/complete` | Existing; lifecycle rules changed |
| Room/type management | `admin.service.ts`, `/admin/rooms` | `GET/POST /admin/room-types`, `PATCH/DELETE /admin/room-types/:typeId`; same methods for `/admin/rooms` and `/:roomId` | Existing |
| Housekeeping/reassignment | `getAdminHousekeeping`, `updateAdminHousekeepingStatus`, `reassignAdminBookingRoom` | `GET /admin/housekeeping`; `PATCH /admin/rooms/:roomId/housekeeping`; `POST /admin/bookings/:bookingId/reassign-room` | Existing deterministic operations |
| Pricing controls/logs | `admin.service.ts`, `/admin/pricing` | `GET/PATCH /admin/pricing/settings`; `GET /admin/pricing/logs` | Existing |
| AI shadow controls | No frontend methods found | `GET/PATCH /admin/pricing/shadow/settings`; `POST /pause`, `/rollback`; `GET /readiness`, `/audits` under same prefix | Backend implemented; intentionally gated/paused |
| User administration | `admin.service.ts`, `/admin/users` | `GET /admin/users`; `GET/PATCH /admin/users/:customerId`; `GET /admin/users/:customerId/audits` | Existing |
| Offline payments/refunds | `admin.service.ts`, `/admin/payments` | `GET /admin/payments`; `POST /admin/bookings/:bookingId/payments`; `POST /admin/payments/:paymentId/refunds` | Existing; deposit may auto-confirm |
| Booking policy/workflow | No frontend methods found | `GET/PATCH /admin/booking-policy`; `GET /admin/bookings/:bookingId/financial-status`; `POST /confirm`, `/no-show`, `/credit-authorization`; `GET /admin/workflow/readiness`; `POST /admin/workflow/expire` | New migration 015; UI pending |
| AI allocation | None found | None | SQL assignment is not AI |
| Occupancy forecasting | None found | None | Historical dashboard and inventory snapshots are not forecasts |

## Rooms and Figma adapters

`GET /rooms`: `{status,count,data:RoomType[],request_id}`. Detail returns `{status,data:RoomType,request_id}` or 404.

```ts
type RoomType = {
  type_id:number; type_name:string; base_price:number; capacity:number;
  total_rooms:number; available_now:number;
};
```

`available_now` describes current business day, including housekeeping/occupancy. Use quote `rooms_available` for selected dates. Metadata is Redis-cached; availability is fresh.

Backend has no gallery/destination/area/beds/amenities/description/reviews/rating in public contract. Keep editorial content separate; API IDs/name/capacity/price govern bookable cards. Do not interpret Figma ID 1 (Premier Suite) as backend ID 1 (Deluxe King). Read-only 2026-09-06 runtime snapshot: Deluxe King (1, VND 1,200,000, capacity 2), Family Suite (2, VND 2,100,000, capacity 4). Never hardcode that inventory snapshot.

## Auth and account

- Register `{full_name,email,password}`; login `{email,password}`. Email trimmed/lowercased, password 8..72, name 1..150. Both rate limited.
- Success `{access_token,user,status,request_id}` plus `hotelai_session` cookie: HttpOnly, SameSite=Lax, path `/`, 7 days, Secure via `COOKIE_SECURE`. Browser ignores token payload and uses non-secret `accessToken:'cookie-session'` marker; actual JWT must not enter localStorage.
- `GET /auth/me` returns user at top level: `{id,full_name,email,phone,nationality,role,account_status,version,status,request_id}`. No data wrapper. Anonymous => 401; inactive account => 403. JWT guard supports Bearer for non-browser use, checks HS256/issuer/audience and current DB account/auth version.
- Browser authenticated fetch uses `credentials:'include'`. Unsafe cross-origin browser mutations rejected before controller; CORS trusted origins must match frontend. Logout clears cookie. Current frontend logout request swallows network errors: robust sign-out is an integration gap.
- Roles `customer|admin`; account states `Active|Suspended|Deactivated`. All `/admin/*` requires active authenticated admin.
- `GET/PATCH /users/me` returns `{status,data:UserProfile,request_id}`; profile adds created_at/updated_at. Patch `{expected_version,full_name?,phone?,nationality?}`, phone/nationality nullable, at least one edit. Stale version => 409.
- Password `{current_password,new_password}`; deactivate `{password}`. Existing service invalidates session. No reset-password or email-verification endpoint found.

## Quote and booking contracts

```ts
type PriceQuoteInput = {
  room_type_id:number;
  check_in_date:string; check_out_date:string;
  total_of_special_requests:number; // integer 0..5, no free-text service storage
  guest_count:number; // integer 1..1000 and <= room capacity
};
```

New clients must send guest count, though legacy backend defaults to 1. Public `POST /pricing/quote` persists immutable snapshot:

```ts
type PriceQuote = {
  quote_id:string;
  room_type:Pick<RoomType,'type_id'|'type_name'|'base_price'|'capacity'>;
  check_in_date:string; check_out_date:string; guest_count:number; nights:number;
  rooms_available:number; rooms_sellable:number; rooms_booked:number;
  occupancy_ratio:number; inventory_snapshot_at:string;
  ai_multiplier:number; ai_model_version:string|null;
  ai_training_run_id:string|null; ai_feature_contract_version:string|null;
  pricing_source:'ai'|'base'; settings_version:number;
  nightly_price:number; total_price:number; currency:'VND';
  is_estimate:true; availability_is_guaranteed:false;
  created_at:string; expires_at:string; price_guaranteed_until:string;
};
```

TTL default 900 seconds, bounded 60..3600. Price guaranteed until expiry; inventory not guaranteed. Intentional AI-disabled setting uses base price/multiplier 1. AI-enabled inference failure/invalid response returns 503; do not fabricate fallback AI output. An already persisted valid quote is bookable using its snapshot.

Telemetry: `{event_type:'quote.exposed.v1'|'quote.rejected.v1',session_id?:UUIDv4,search_id?:UUIDv4}` + `Idempotency-Key`. Result `{quote_event_id,quote_id,event_type,session_id,search_id,occurred_at,replayed}`. Reuse existing telemetry: exposure after render, rejection only after confirmed exposure and intentional user change. Unmount/network errors are not rejection.

Create requires auth: `PriceQuoteInput & {quote_id:string}` + stable `Idempotency-Key`. Legacy backend permits missing quote/key; new UI must send both. Same key/input returns committed booking; changed input => 409. Quote must match room/dates/guests/request count and remain usable. Expired/used/rejected/mismatched quote => 409. No inventory => 404. Allocation is deterministic available `room_number ASC` with advisory and row locks, not AI.

Creation `data`: `{booking,quote_id,room_id,room_number,applied_price,nightly_price,nights,total_price,ai_multiplier,ai_model_version,ai_training_run_id,ai_feature_contract_version,pricing_source,settings_version,payment_status,paid_amount,balance_due}`. `booking` includes ID/dates/customer/guest/status plus policy/lifecycle fields below. Initial payment is Unpaid; an idempotent replay can reflect later payment/terminal state and must not always be typed Unpaid.

History returns room name/number snapshots, dates, guest_count, monetary/payment fields, `can_cancel`, lifecycle and policy terms. Trust `can_cancel`. Cancellation returns updated summary and may create refund due; a refund is only complete when the ledger says so.

## New booking workflow (015/016)

States: `Pending|Confirmed|CheckedIn|Completed|Canceled|Expired|NoShow`.

- Creation snapshots `policy_version,deposit_required,checkout_payment_required,pending_expires_at`, plus `lifecycle_version`. Deposit > 0 => Pending, otherwise Confirmed. Runtime policy is configurable; do not assume migration defaults.
- Pending reserves inventory until expiry/cancel/confirm. Expiry worker default `BOOKING_EXPIRY_POLL_MS=15000`, retires overdue holds and records distinct events/outcomes.
- Recording sufficient deposit with payment ledger auto-confirms unexpired Pending booking. This is not a browser card charge.
- Check-in requires Confirmed/ready physical room. Check-out may require full payment or audited credit authorization; room becomes Dirty. NoShow applies to Confirmed after check-in business date, not arbitrary cancellation.
- Snapshots/events/audits immutable. 016 adds unprivileged `hotelai_runtime` group and explicit write grants; environment login provisioning belongs to operations.

Policy result `{policy_id,version,deposit_percent,pending_ttl_minutes,require_full_payment_at_checkout,updated_by,reason,updated_at}`. Patch `{expected_version,reason,deposit_percent?,pending_ttl_minutes?,require_full_payment_at_checkout?}`; reason 10..500, deposit 0..100 with 2 decimals, TTL 1..1440 minutes, at least one edit.

Financial status: booking identity/status/dates plus `lifecycle_version,policy_version,deposit_required,checkout_payment_required,pending_expires_at,expired_at,no_show_at,hold_expired,booking_total,net_paid,deposit_due,balance_due,refund_due,credit_authorized,can_check_out`.

Confirm/no-show `{expected_version,reason}` + required `Idempotency-Key` => `{replayed,booking:FinancialStatus}`. Credit also requires positive `authorized_amount` <= outstanding balance => `{replayed,authorization}`; CheckedIn only, one per booking. Manual expiry `{limit?:number}` 1..100/default 100 => `{expired_count,booking_ids}`. Readiness reports pending/backlog counts, oldest expired time, expiry worker state, `notification_channel:'in_app'`.

Notifications are in-app only. List pagination result `{status,count,data,total,unread,limit,offset,request_id}`; row `{notification_id,booking_id,kind,payload:{status,pending_expires_at,deposit_required},created_at,read_at}`. Mark-read `{notification_id,read_at}` for authenticated owner. No email/SMS delivery exists.

Frontend drift at inspection: `types/booking.type.ts` has only four states and lacks guest/policy/expiry/lifecycle fields. `types/room.type.ts` has minimal creation booking and payment_status Unpaid only. Workflow/notification/shadow methods absent. Checkout success/history/admin badges need updating after UI gate.

## Admin operations details

- Dashboard months 3..24/default 6 represents historical metrics, not forecasts. Bookings query accepts pagination/status/search (150 chars), including all seven new states.
- Room type create `{name,base_price,capacity}`, patch partial; public name maps to type_name. Physical room create `{type_id,room_number,current_status?}`, patch partial. Status `Available|Occupied|Maintenance`; lifecycle guards reject illegal edits/deletes.
- Housekeeping status query `Ready|Dirty|Cleaning` + pagination. Patch `{target_status,expected_version,reason}` + `Idempotency-Key`. Reassign `{target_room_id,expected_assignment_version,reason}` + header; preserves price/AI lineage/history.
- Pricing settings include ai_enabled/version; patch `{ai_enabled,expected_version}`. Logs paginated/model lineage. Do not bypass policy from UI.
- Payment body `{amount,method:'Cash'|'BankTransfer'|'CardTerminal',idempotency_key,external_reference?,note?}`; refund `{amount,idempotency_key,note?}`. Here key is JSON, not header. No raw card/PAN/CVV. Payment states `Unpaid|PartiallyPaid|Paid|RefundPending|PartiallyRefunded|Refunded`.
- Admin user changes/audits: use `admin-users.controller.ts`, `dto/admin-users.dto.ts`, current admin service; preserve optimistic version and audit reason.

## Private AI capabilities

- `GET /health/live` alive; `/health` or `/api/v1/health` ok or 503 model_unavailable. `GET /api/v1/model-info` => `{status:'ready',metadata}`.
- `POST /api/v1/predict-price`: `{lead_time,check_in_date,check_out_date,guest_count}` => `{status:'success',ai_multiplier:0.5..3,model_version,training_run_id,feature_contract_version,features,message}`. No confidence/reason field. Features 2.0.0: lead_time, arrival month sin/cos, arrival weekday sin/cos, stay_nights, weekend_nights, weekend_share, guest_count. Special-request count deliberately excluded.
- Backend validates exact expected features/contract/finite multiplier/lineage, default timeout 5000ms. Unavailable/invalid inference => Core 503. Browser consumes `/pricing/quote` only.
- Optional conversion: `GET /api/v1/conversion-model-info`, `POST /api/v1/predict-conversion`. Input adds capacity/inventory/occupancy snapshot, base/offered nightly price, room type name, currency, pricing source to stay context. Output probability 0..1, model/training/feature lineage, `lifecycle_stage:'shadow_only'`.
- `POST /api/v1/optimize-price-shadow` adds champion multiplier, min/max/change guardrails, optional candidate controls. Returns proposed/guardrailed multiplier, champion/selected probabilities, candidate prices/expected revenue scores, guardrail status/reasons, lineage. Core fail-open shadow call never replaces champion price.
- Shadow setting patch requires expected_version/change_reason plus allowed model/guardrail/readiness fields in `dto/pricing.dto.ts`. Pause `{expected_version,change_reason}`; rollback adds target_version. Audits paginated. No promote endpoint.
- Challenger artifact intentionally absent until real-data gate: 2000 mature confirmed exposures, 200 positive/200 negative, 28 days, chronological evaluation. Live optimizer additionally needs documented shadow/causal evidence. Preserve gates; code existence does not establish live model readiness.
- No AI allocation/occupancy forecasting found across backend controllers and AI routers/services/contracts. Occupancy fields are snapshots; room assignment is SQL.

## Verification and startup reference

- 2026-09-06 backend `npm run build` PASS. AI initial pytest hit Windows temp/cache ACL errors; rerun `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider --basetemp <new verified workspace temp path>` PASS: 25 tests/16 NumPy-joblib deprecation warnings. These predate migrations 015/016, not validation of those files.
- 2026-09-06 live read-only gateway health/readiness/rooms/room 1 => 200; anonymous auth/me => 401; AI model ready random_forest_v2. Revalidate runtime after new migrations/backend rebuild.
- Full stack: existing root `.env` from `.env.example`; `docker compose config --quiet`, `docker compose up -d --build`, `docker compose ps`. README/operations scripts define migration/backup/runtime-role setup. Never overwrite existing env or print secrets.
- Native backend: `npm ci`, `npm run build`, `npm run start:dev` with DB/JWT/AI/Redis/Kafka config. AI: virtualenv, requirements install, `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`. Frontend `npm ci`, `npm run dev` with correct core URL/non-conflicting ports.
- Existing smoke scripts cover public journey, API contract, accounts/payments/turnover/new workflow. Suite restarts gateway/backend; outage suite stops AI. Run mutation suites with isolated test stack/fixtures, not blindly on working user database. Read-only discovery did not run them.
