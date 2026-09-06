# API integration map

Discovery in progress. Existing frontend services are authoritative.

| Feature | UI | Existing service | Backend endpoint | Status |
|---|---|---|---|---|
| Rooms | /rooms | room.service.ts | GET /api/v1/core/rooms | Existing integration; Figma port pending |
| Room detail | /rooms/[id] | room.service.ts | GET /api/v1/core/rooms/:id | Existing integration; Figma port pending |
| Booking/quotes | /checkout, future /book | booking.service.ts | Audit pending | Preserve existing workflow |
| Auth | /login,/register | auth.service.ts | /api/v1/core/auth/* | HttpOnly session cookie |
| Profile | /profile | user.service.ts | /api/v1/core/users/* | Existing integration |
| Admin | /admin/** | admin.service.ts | /api/v1/core/admin/* | Existing integration |
| AI pricing | quote/checkout, /admin/pricing | booking/admin services | Backend calls private FastAPI | Audit pending |
| AI allocation/forecast | TBD | TBD | Not yet found | Do not invent |

## Confirmed shapes

RoomType: `{type_id:number,type_name:string,base_price:number,capacity:number,total_rooms:number,available_now:number}`. Monetary values are VND. Catalog has no image/gallery/destination/review metadata.

PriceQuote includes quote_id, room_type, check_in_date/check_out_date, guest_count, nights, date-specific availability, AI multiplier/model lineage, pricing_source (`ai`/`base`), settings_version, nightly_price, total_price, currency (`VND`), expiration. Quote is estimate; inventory not guaranteed until booking.

Backend success metadata: `{status:'success', request_id}`; room payload in `data`. Errors normalized by `core-api.ts` as `CoreApiError` with HTTP status, safe fallback, request ID and tracing metadata. Confirm endpoint-specific shapes before mutation.

Server room requests use BACKEND_API_URL then NEXT_PUBLIC_API_URL. Runtime/AI URLs and credential handling will be fully documented after audit.
