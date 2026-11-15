# Hotel AI

Hệ thống đặt phòng khách sạn nhiều dịch vụ, gồm giao diện khách hàng, bảng điều hành quản trị, backend nghiệp vụ và dịch vụ định giá AI.

## Demo AI học thuật

Phần thực nghiệm dùng dữ liệu thật Portugal 2015–2017 để ước lượng ADR tham chiếu (EUR) và nguy cơ hủy/no-show. **White Sand Boutique Hotel Đà Nẵng** (`6` hạng phòng, `54` phòng vật lý) là bối cảnh mô phỏng trên hệ thống; kết quả không chứng minh giá tối ưu, tăng doanh thu hoặc hiệu quả tại Việt Nam nếu chưa có thực nghiệm thị trường thật.

Chạy toàn hệ thống qua Nginx tại `http://localhost`, mở `/ai-experiment` hoặc `/decision-lab`. Xem thêm [hướng dẫn demo & đánh giá kiểm thử](docs/HUONG_DAN_DEMO_VA_DANH_GIA.md), [kết quả thực nghiệm](docs/AI_EXPERIMENT_RESULTS.md), [kịch bản bảo vệ](docs/AI_DEFENSE.md) và [lộ trình E2E](docs/E2E_CONTEXT_AND_ROADMAP.md). Hai pipeline academic dùng hợp đồng riêng và được bảo toàn nguyên vẹn.

## Triển khai Production & Tên miền thương hiệu (HTTPS)

- **Triển khai Production với tên miền riêng (Khuyên dùng)**: Xem [Hướng dẫn triển khai Production & Tên miền thương hiệu](docs/PRODUCTION_DOMAIN_DEPLOYMENT.md). Hướng dẫn thiết lập tên miền riêng (`.vn`, `.com`), tối ưu CDN/DDoS qua Cloudflare, tự động cấp HTTPS chuẩn A+ qua Caddy, bảo mật mạng nội bộ và tích hợp thẻ xem trước thương hiệu (OpenGraph preview).
- **Môi trường thử nghiệm miễn phí**: Xem [hướng dẫn dùng VM miễn phí cùng DuckDNS](docs/FREE_VM_DEPLOYMENT.md) (chỉ phù hợp trình diễn học thuật tạm thời; không có cam kết uptime hoặc bảo vệ thương hiệu).

> [!IMPORTANT]
> File cấu hình bí mật `.env.production` chỉ lưu trực tiếp trên máy chủ và tuyệt đối không commit lên git repository.

## Kiến trúc

- `1_infrastructure`: PostgreSQL schema/migration, seed và Nginx API Gateway.
- `2_ai_pricing_service`: FastAPI, Pydantic, lớp inference và Random Forest đã huấn luyện.
- `3_backend_core`: NestJS, JWT, phòng, báo giá, booking và nghiệp vụ quản trị.
- `4_frontend_nextjs`: Next.js App Router cho khách hàng và quản trị viên.
- PostgreSQL lưu dữ liệu nghiệp vụ, snapshot lịch sử, audit và transactional outbox.
- Redis cache catalog loại phòng; tồn kho theo ngày vẫn luôn được đọc trực tiếp từ PostgreSQL.
- Kafka nhận domain event từ outbox theo cơ chế at-least-once, dùng `event_id` để consumer khử trùng lặp.
- Nginx cung cấp một cổng truy cập tại `http://localhost`.

## Chức năng đã hoạt động

Khách hàng có thể:

- khám phá khách sạn **White Sand Boutique Hotel Đà Nẵng** (`89-91 Võ Văn Kiệt, Sơn Trà`), tìm kiếm, lọc và mở chi tiết 6 hạng phòng tại `/`, `/about`, `/rooms` và `/rooms/[id]`;
- chọn ngày lưu trú, xem tồn kho thực tế theo khoảng ngày và nhận báo giá AI minh bạch 4 nguồn `(A)/(B)/(C)/(D)` tại `/book` và `/checkout` (tự động ghi nhận `quote.exposed.v1` khi báo giá hiển thị thật trên màn hình);
- áp dụng mã ưu đãi PostgreSQL (`WHITESAND10`, `SUMMER15`, `DIFF2026`, `SUITE20`, kiểm tra `min_room_type_id`, giới hạn lượt dùng, hạn dùng `UTC+7` và giá sàn `452,000 VND/đêm`);
- đăng ký/đăng nhập tại `/login` và `/register`, xác nhận booking, xem lịch sử, hộp thông báo (`/bookings#notifications` + badge `AccountMenu`), sổ thanh toán và hủy booking đủ điều kiện hoàn trả tồn kho & lượt coupon tại `/bookings`;
- cập nhật hồ sơ, đổi mật khẩu và vô hiệu hóa tài khoản tại `/profile`;
- trao đổi với trợ lý **White Sand assistant** (`ChatWidget`, `hybrid_bm25_tfidf_v1`) dùng **Hybrid BM25 + TF-IDF RAG**, trích xuất slot ngày/hạng phòng/coupon và gọi công cụ đọc trực tiếp tồn kho theo ngày & lượt coupon trong PostgreSQL, trả chip trích dẫn SOP kèm nút chuyển thẳng sang `/book`.

Quản trị viên có thể:

- xem dashboard dữ liệu thật & phân tích định giá theo đêm tại `/admin`;
- xem sơ đồ phòng (Rack/Tape Chart) trực quan và kéo/chuyển phòng tại `/admin/tape-chart`;
- tìm kiếm, lọc, phân trang, hủy, xác nhận/ủy quyền thẻ trước checkout, cấu hình chính sách giữ phòng (`Pending` TTL/deposit), quét hết hạn, nhận phòng, trả phòng và đóng booking no-show tại `/admin/bookings`;
- CRUD loại phòng/phòng vật lý, giá trần kê khai (`declared_max_price`) và quản lý trạng thái sẵn sàng/bảo trì tại `/admin/rooms`;
- quản lý buồng phòng `Dirty → Cleaning → Ready`, đổi phòng giữ nguyên giá/lineage và Smart Upgrade tại `/admin/housekeeping`;
- theo dõi **Shadow Challenger & Readiness (6 gate + kiểm toán 0% giao thoa hạng phòng với White Sand)**, **AI Drift Monitoring (PSI + Empirical Portugal V2 Drift + Mahalanobis OOD)**, **Guardrailed Thompson Sampling Bandit Lab** và **Explain Price Sample (Saabas + Split Conformal 90%)** tại `/admin/pricing`;
- mô phỏng doanh thu **P8 Revenue Simulator**, CRUD `pricing_coupons`, thẩm định thị trường Đà Nẵng (`native_vn_nlp_v1` + Open-Meteo), tối ưu phân bổ phòng **Google OR-Tools CP-SAT Live**, **Portfolio Multi-Night 6-Tier Optimizer** (kèm shadow price & 1-tier upgrade) và chạy **4 kịch bản Stress-Test Sandbox** tại `/admin/revenue-simulator`;
- tìm kiếm, phân trang, cấp/hạ quyền, khóa/mở khóa người dùng và xem audit tại `/admin/users`;
- ghi nhận các khoản thu thủ công từ booking, lọc ledger và hoàn tiền theo giao dịch gốc tại `/admin/payments`.

Booking dùng khóa advisory và transaction để chống overbooking. Booking detail cùng pricing log lưu snapshot tên phòng, tên loại phòng, giá cơ sở, hệ số AI, nguồn giá và version cấu hình nên dữ liệu lịch sử không đổi khi catalog được sửa.

Vòng đời lưu trú là `Confirmed → CheckedIn → Completed`; nhánh hủy duy nhất là `Confirmed → Canceled`. Check-in chỉ được thực hiện từ ngày nhận phòng đến trước ngày trả phòng và bắt buộc phòng `Available + Ready`; check-out có thể thực hiện sớm, không tự điều chỉnh giá đã chốt và trả phòng về `Available + Dirty`. Mỗi transition khóa booking và phòng, cập nhật audit người/thời điểm thao tác, gắn `rooms.occupancy_booking_id`, đổi trạng thái phòng và ghi outbox trong cùng một transaction. Endpoint `complete` cũ được giữ riêng để đóng booking `Confirmed` đã quá ngày trả phòng như trường hợp no-show. Chi tiết OPS-001A nằm tại [`docs/ops-001a-room-turnover.md`](docs/ops-001a-room-turnover.md).

## Khởi động bằng Docker

Yêu cầu: Docker Desktop đang chạy và cổng `80`, `5432`, `6379`, `9092` còn trống trên máy.

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Dán chuỗi vừa tạo vào `JWT_SECRET`, đổi `POSTGRES_PASSWORD`, rồi chạy:

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Các endpoint kiểm tra:

- Frontend: `GET http://localhost/api/health`
- Backend liveness: `GET http://localhost/api/v1/core/health/live`
- Backend readiness + PostgreSQL/Redis/Kafka/outbox: `GET http://localhost/api/v1/core/health/ready`
- Prometheus metrics: `GET http://localhost/api/v1/core/metrics`
- AI readiness: `GET http://localhost/api/v1/ai/health`
- AI liveness nội bộ: `GET http://ai_service:8000/health/live`

PostgreSQL, Redis và Kafka mặc định chỉ bind vào `127.0.0.1`. Có thể đổi các biến `*_BIND_ADDRESS` nếu thật sự cần truy cập từ máy khác.

Redis và Kafka là dependency fail-open của Core API: khi một service tạm ngắt, readiness trả `status: degraded` nhưng vẫn là HTTP `200`; booking và các mutation tiếp tục commit vào PostgreSQL. Catalog tự rơi về database, còn domain event được giữ trong outbox và gửi lại với exponential backoff sau khi Kafka hồi phục. PostgreSQL hoặc bảng outbox không khả dụng mới làm readiness trả `503`.

Topic mặc định là `hotel.domain-events.v1`. Backend tự tạo topic nếu chưa có; số partition và replication factor được cấu hình bằng `KAFKA_TOPIC_PARTITIONS` và `KAFKA_TOPIC_REPLICATION_FACTOR`. Với nhiều broker, tăng replication factor tương ứng.

## Xác thực và bảo mật phiên

Backend vẫn trả access token để các smoke test/CLI dùng Bearer token, nhưng frontend không lưu hoặc gửi token đó. Trình duyệt sử dụng cookie `hotelai_session` với các thuộc tính `HttpOnly`, `SameSite=Lax` và `Path=/`.

Khi triển khai HTTPS:

```dotenv
COOKIE_SECURE=true
CORS_ORIGINS=https://hotel.example.com
```

Các mutation từ browser có `Origin` không nằm trong danh sách cho phép hoặc `Sec-Fetch-Site: cross-site` bị từ chối `403`. Nginx giới hạn tốc độ auth/core API, giới hạn body, ẩn version và thêm các security header cơ bản.

Không có tài khoản admin hoặc mật khẩu mặc định. Đăng ký một tài khoản thường rồi cấp quyền bằng lệnh:

```powershell
Set-Location 3_backend_core
npm run user:set-role -- admin@example.com admin
```

Thu hồi quyền bằng role `customer`. Backend đọc lại người dùng và role từ database trên mỗi request, nên token/cookie cũ mất quyền admin ngay sau khi hạ role.

Đổi mật khẩu, khóa/mở khóa hoặc vô hiệu hóa tài khoản tăng `auth_version`, làm phiên cũ hết hiệu lực. Cập nhật hồ sơ và thao tác admin dùng `expected_version` để phát hiện cập nhật đồng thời. Tài khoản chỉ được tự vô hiệu hóa sau khi không còn booking đang hoạt động (`Confirmed` hoặc `CheckedIn`); dữ liệu cá nhân được ẩn nhưng dòng khách hàng và lịch sử booking vẫn được giữ để bảo toàn sổ sách. Quản trị viên hoạt động cuối cùng không thể tự vô hiệu hóa.

## API chính

Public/core:

- `GET /api/v1/core/rooms`
- `GET /api/v1/core/rooms/:typeId`
- `POST /api/v1/core/pricing/quote` (lưu immutable AI quote, trả `quote_id`, model/training-run/feature-contract version và thời hạn bảo đảm giá)
- `POST /api/v1/core/pricing/quotes/:quoteId/events` (ghi `quote.exposed.v1` hoặc `quote.rejected.v1`; bắt buộc `Idempotency-Key`)
- `POST /api/v1/core/auth/register`
- `POST /api/v1/core/auth/login`
- `POST /api/v1/core/auth/logout`
- `GET /api/v1/core/auth/me`
- `GET/PATCH /api/v1/core/users/me`
- `PATCH /api/v1/core/users/me/password`
- `POST /api/v1/core/users/me/deactivate`
- `POST /api/v1/core/bookings` (`guest_count` mặc định `1`; booking dùng `quote_id`
  yêu cầu quote đã có `quote.exposed.v1`; gửi `Idempotency-Key` 8-100 ký tự để
  khóa giá/retry an toàn)
- `GET /api/v1/core/bookings`
- `PATCH /api/v1/core/bookings/:bookingId/cancel`
- `GET /api/v1/core/bookings/:bookingId/payment`
- `GET /api/v1/core/users/me/notifications` & `PATCH /api/v1/core/users/me/notifications/:notificationId/read`
- `GET /api/v1/core/pricing/coupons` & `GET /api/v1/core/pricing/calendar`
- `POST /api/v1/core/chat`

Admin, đều yêu cầu role `admin`:

- `GET/POST/PATCH/DELETE /api/v1/core/admin/room-types`
- `GET/POST/PATCH/DELETE /api/v1/core/admin/rooms`
- `GET /api/v1/core/admin/housekeeping?status=Dirty&limit=20&offset=0`
- `PATCH /api/v1/core/admin/rooms/:roomId/housekeeping` (bắt buộc `Idempotency-Key`)
- `GET /api/v1/core/admin/tape-chart`
- `GET /api/v1/core/admin/dashboard?months=6`
- `GET /api/v1/core/admin/bookings?limit=20&offset=0&status=Confirmed&search=...`
- `POST /api/v1/core/admin/bookings/:bookingId/confirm` & `.../credit-authorization` & `.../no-show`
- `PATCH /api/v1/core/admin/bookings/:bookingId/check-in`
- `PATCH /api/v1/core/admin/bookings/:bookingId/check-out`
- `POST /api/v1/core/admin/bookings/:bookingId/reassign-room` (bắt buộc `Idempotency-Key`)
- `GET/PATCH /api/v1/core/admin/booking-policy` & `POST /api/v1/core/admin/workflow/expire`
- `GET /api/v1/core/admin/allocations/queue` & `POST /api/v1/core/admin/allocations/optimize-queue`
- `PATCH /api/v1/core/admin/bookings/:bookingId/complete` (đóng no-show đã quá hạn)
- `POST /api/v1/core/admin/bookings/:bookingId/payments`
- `GET /api/v1/core/admin/payments?limit=20&offset=0&transaction_type=Payment&method=Cash&search=...`
- `POST /api/v1/core/admin/payments/:paymentId/refunds`
- `GET /api/v1/core/admin/pricing/intelligence`, `GET /api/v1/core/admin/pricing/drift`, `POST /api/v1/core/admin/pricing/explain-sample`
- `GET/PATCH /api/v1/core/admin/pricing/settings`
- `GET /api/v1/core/admin/pricing/logs?limit=20&offset=0`
- `GET/PATCH /api/v1/core/admin/pricing/shadow/settings`, `GET .../runtime-status`, `POST .../pause`, `POST .../rollback`, `GET .../readiness`, `GET .../audits`
- `GET/POST /api/v1/core/admin/coupons`, `PATCH /api/v1/core/admin/coupons/:code`
- `GET /api/v1/core/revenue/live-context`, `GET /.../scenarios`, `POST /.../decision`, `POST /.../market-decision`, `POST /.../optimize-allocation(-live)`, `GET /.../sandbox/scenarios`, `POST /.../sandbox/run`
- `GET /api/v1/core/admin/users?limit=20&offset=0&role=customer&status=Active&search=...`
- `GET/PATCH /api/v1/core/admin/users/:customerId`
- `GET /api/v1/core/admin/users/:customerId/audits`

AI:

- `POST /api/v1/ai/predict-price` (V2 Random Forest + Split Conformal 90% + Mahalanobis OOD Gate) & `POST /api/v1/ai/explain-price` (Saabas Tree Interpreter)
- `GET /api/v1/ai/health`
- `GET /api/v1/ai/model-info` (metadata, feature contract và metric của artifact đang phục vụ)
- `GET /api/v1/ai/monitoring/drift` & `POST /api/v1/ai/monitoring/evaluate-drift` (PSI + Empirical Portugal baseline drift)
- `GET /api/v1/ai/conversion-model-info` (chỉ khả dụng khi có challenger artifact hợp lệ)
- `POST /api/v1/ai/predict-conversion` & `POST /api/v1/ai/optimize-price-shadow` (shadow-only)
- `GET/POST /api/v1/ai/revenue/*` (Decision Engine, Đà Nẵng `native_vn_nlp_v1` market decision, OR-Tools CP-SAT allocator, Portfolio multi-night optimizer, Guardrailed Thompson Sampling Bandit simulator, Taxonomy drift audit, Scenario Sandbox)
- `POST /api/v1/ai/concierge/ask` (Hybrid BM25 + TF-IDF SOP RAG & bilingual booking slot extractor)

## Hợp đồng response của Core API

Mọi response JSON thành công của Core API có `request_id`; backend tự thêm `status: "success"` nếu controller chưa có `status`, đồng thời giữ nguyên các field nghiệp vụ hiện hữu như `data`, `message`, `count`, `total`, `limit` và `offset`. Vì vậy auth vẫn trả `user`/`access_token` ở top-level và không bị bọc thêm một lớp `data`.

Mọi lỗi HTTP do Core API xử lý có đúng một cấu trúc chung:

```json
{
  "status": "error",
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["room_type_id must be an integer number"],
  "path": "/api/v1/core/pricing/quote",
  "timestamp": "2026-08-29T06:00:00.000Z",
  "request_id": "7f80b27de25c4f3ea078009ace36a612"
}
```

`message` là chuỗi hoặc mảng chuỗi validation. `path` không chứa query string và lỗi `500` không trả stack/message nội bộ. Header `X-Request-ID` luôn trùng `request_id` trong JSON; frontend giữ ID này trong error object để có thể đối chiếu log khi hỗ trợ sự cố.

Các ngoại lệ theo chuẩn giao thức: health giữ `status: "ok" | "degraded"`, `/metrics` giữ nguyên Prometheus text, CORS preflight trả `204` rỗng và `HEAD` không có body.

## Event và quan sát hệ thống

Các mutation quan trọng ghi domain event trong cùng transaction PostgreSQL với dữ liệu nghiệp vụ. Publisher dùng `FOR UPDATE SKIP LOCKED`, khóa theo `aggregate_id` khi gửi Kafka, chỉ đánh dấu `published_at` sau khi broker xác nhận và tăng `attempts` cho từng lần thử. Envelope gồm `event_id`, `aggregate_type`, `aggregate_id`, `event_type`, `occurred_at` và `payload`; không chứa mật khẩu, email hay access token.

Các event hiện có:

- `customer.registered.v1`, `customer.profile-updated.v1`, `customer.password-changed.v1`, `customer.account-updated.v1`, `customer.deactivated.v1`;
- `booking.created.v1`, `booking.canceled.v1`, `booking.checked-in.v1`, `booking.checked-out.v1`, `booking.completed.v1`;
- `payment.recorded.v1`, `payment.refunded.v1`.
- `quote.generated.v1`, `quote.exposed.v1`, `quote.rejected.v1`, `quote.accepted.v1`,
  `booking.canceled.v1`, `stay.completed.v1` cho funnel định giá.

Consumer phải xử lý idempotent theo `event_id` vì delivery là at-least-once. Publisher chỉ chọn event chưa publish cũ nhất của từng aggregate; message Kafka tiếp tục dùng `aggregate_id` làm key, nên thứ tự của cùng customer/booking/payment được giữ cả khi event đầu phải retry. Message có các header `event-id`, `event-type`, `aggregate-type`.

Nginx tạo một `X-Request-ID` cho mỗi request, chuyển cùng ID vào backend và trả đúng một header cho client. Backend ghi access log JSON có request ID, method, route, status và thời gian xử lý nhưng không ghi query string, IP hay payload chứa PII. `/metrics` xuất process metrics, HTTP counter/histogram, số event pending, publish thành công và publish lỗi theo định dạng Prometheus.

Báo giá không giữ tồn kho, nhưng giá/model và inventory/occupancy snapshot được lưu bất biến và mặc định bảo đảm 15 phút. Booking gửi `quote_id` còn hạn sẽ dùng đúng snapshot đó, kiểm tra lại tồn phòng rồi đánh dấu quote accepted trong cùng transaction; nhờ vậy quote hợp lệ vẫn được chấp nhận nếu AI tạm gián đoạn. `pricing_quote_events` ghi append-only các mốc generated/exposed/rejected/accepted/canceled/completed vào outbox; view `pricing_quote_training_dataset_v1` tạo label censor-aware, để quote còn mở có label `NULL` thay vì bị tính sai thành không chuyển đổi. UI reference đã ghi exposed khi quote thật sự xuất hiện và chỉ ghi rejected sau exposure khi người dùng thay/bỏ quote. Client cũ không gửi `quote_id` vẫn dùng đường tương thích và tính giá mới. Nếu AI pricing champion đang bật nhưng không khả dụng, tạo quote hoặc booking không có quote trả `503` và không tạo dữ liệu dở dang. Nếu quản trị viên tắt AI, backend bỏ qua cuộc gọi mạng, dùng hệ số `1` và vẫn ghi audit với nguồn `base`.

Conversion challenger là dependency tùy chọn và luôn fail-open. Khi shadow được
bật, Core API gọi optimizer sau khi đã lưu quote, ghi attempt/decision cùng model
lineage, rồi PostgreSQL áp dụng guardrail cuối cùng. Kết quả chỉ dùng để đánh giá;
`pricing_quotes.ai_multiplier` và giá khách nhìn thấy vẫn là champion. Policy mặc
định là pause, không có endpoint promote, và lỗi/timeout challenger không làm hỏng
luồng báo giá. Readiness chỉ tính attempt/decision thuộc đúng cửa sổ policy theo
thời điểm tạo quote; telemetry ngoài cửa sổ được báo riêng và chặn review-ready.

## Kiểm thử

Cài dependency local khi muốn chạy script trực tiếp:

```powershell
Set-Location 3_backend_core
npm install
```

Mỗi smoke test tự chờ Core API sẵn sàng và tự dọn dữ liệu tạm:

```powershell
npm run test:public-journey-smoke
npm run test:smoke

docker compose restart backend_core
npm run test:user-accounts-smoke

docker compose restart backend_core
npm run test:payments-smoke

docker compose restart backend_core
npm run test:admin-smoke

docker compose restart backend_core
npm run test:admin-operations-smoke

docker compose restart backend_core
npm run test:stay-lifecycle-smoke

docker compose restart backend_core
npm run test:room-turnover-smoke

docker compose restart backend_core
npm run test:api-contract-smoke

npm run test:events-observability-smoke
npm run test:infrastructure-resilience-smoke
```

Để chạy theo nhóm ổn định trên cả Windows và Linux, dùng runner tổng hợp. Runner reset rate-limit state của Nginx và Nest giữa các suite, nên các test auth không gây `429` giả cho nhau. Nhánh AI outage luôn khởi động lại AI và backend trong phần cleanup kể cả khi assertion thất bại:

```powershell
Set-Location 3_backend_core
npm run test:suite
npm run test:infrastructure-suite
npm run test:ai-outage-suite

# Chạy cả ba nhóm theo thứ tự
npm run test:all
```

Nếu máy có GNU Make, các lệnh tương ứng là `make test`, `make test-infrastructure`, `make test-ai-outage`, `make test-all` và `make test-ai`.

Các test bao phủ cookie HttpOnly, báo giá, inventory snapshot, exposure idempotent, quote rejection/acceptance, thay đổi tồn kho sau đặt/hủy, JWT, quyền sở hữu, ngày lưu trú không lệch múi giờ, overbooking đồng thời, admin `401/403`, demotion, duplicate đồng thời, CRUD, snapshot lịch sử, version AI, dashboard, pagination và transition trạng thái nguyên tử. Smoke test lưu trú còn ép check-in/check-out đồng thời, xác nhận đúng một request thành công, phòng `Occupied/Available` và booking liên kết cùng transaction, chặn hủy/vô hiệu hóa khi khách đang ở, chặn nhận phòng sớm/phòng bảo trì và chờ event Kafka được xác nhận. Smoke turnover kiểm tra checkout-to-Dirty, queue/transition housekeeping, idempotency/version, tồn kho ngày hiện tại/tương lai, hai reassignment cạnh tranh, target sai, bảo toàn giá cùng AI lineage, chuyển khách đang ở và append-only ledger. Smoke test tài khoản kiểm tra optimistic conflict, thu hồi phiên sau đổi mật khẩu/khóa tài khoản, phân quyền có hiệu lực ngay, chống tự khóa admin cuối cùng, chặn vô hiệu hóa khi còn booking và ẩn PII có audit. Smoke test payment kiểm tra thu một phần/toàn phần, hủy booking đã thu tiền, hoàn theo giao dịch gốc, chống overpay/overrefund và idempotency khi hai request chạy đồng thời. Smoke test contract kiểm tra response success `200/201`, pagination, logout cookie, health/metrics, CORS preflight, request ID và lỗi `400/401/403/404/409/413`, kể cả JSON hỏng, body quá lớn và query-string không bị lộ. Smoke test event kiểm tra cache TTL/invalidation, outbox được Kafka xác nhận, consumer đọc đúng envelope/header, health, metrics và request ID. Smoke test resilience chủ động dừng Redis/Kafka, xác nhận API fail-open rồi kiểm tra event pending tự publish sau khi broker phục hồi; script luôn khởi động lại service trong phần cleanup.

Kiểm tra fallback khi AI dừng:

```powershell
docker compose stop ai_service
docker compose restart backend_core
npm run test:ai-outage-smoke
docker compose start ai_service
```

Kiểm tra riêng AI, bao gồm model thật, payload sai và model bị thiếu:

```powershell
Set-Location ..\2_ai_pricing_service
docker build --target test -t hotelai-ai-test:local .
docker run --rm hotelai-ai-test:local
```

Kiểm thử tự động 2 kịch bản định giá động theo giờ thời gian thực (Kịch bản A: Surge cao điểm tối & Kịch bản B: Flash Clearance xả phòng giờ chót):

```powershell
Set-Location ..\2_ai_pricing_service
python scripts/verify_hourly_scenarios.py
# Hoặc chạy kiểm thử tự động với pytest:
python -m pytest tests/test_scenarios_hourly_pricing.py
```

Xuất dataset không PII và chạy conversion readiness/training:

```powershell
Set-Location 3_backend_core
npm run ai:export-conversion-data -- --output=..\2_ai_pricing_service\data\conversion-training.csv

Set-Location ..\2_ai_pricing_service
python notebooks/train_conversion_model.py `
  --data data\conversion-training.csv `
  --report app\models\conversion_readiness.json
```

Nếu chưa đạt gate mặc định (2.000 mature exposures, 200 positive, 200 negative,
28 ngày), lệnh training kết thúc khác `0`, chỉ ghi readiness report và không ghi
đè artifact. Đây là checkpoint an toàn bình thường. Khi kiểm tra môi trường cô lập,
hai smoke shadow cần opt-in vì chúng chủ động đổi policy và tạo quote:

```powershell
$env:AI_SHADOW_SMOKE_ALLOW_MUTATION='true'
Set-Location ..\3_backend_core
npm run test:ai-shadow-smoke

# Khởi động lại riêng Core API với AI_SHADOW_OPTIMIZER_URL trỏ tới endpoint
# không khả dụng, rồi xác minh fail-open; script tự bật và pause policy cô lập.
npm run test:ai-shadow-fail-open-smoke
```

Huấn luyện lại artifact và xuất metadata sidecar:

```powershell
Set-Location 2_ai_pricing_service
python notebooks/train_model.py

# So sánh v1/v2 trên cùng chronological holdout, không ghi model serving
python notebooks/benchmark_feature_v2.py
```

Pipeline sắp xếp theo ngày đến và chỉ huấn luyện trên quá khứ; toàn bộ ngày từ cutoff trở đi là holdout nên cùng một ngày không thể rơi vào cả train và test. Contract `2.0.0` dùng lead time, mã hóa chu kỳ tháng/thứ, số đêm, số đêm/tỷ lệ cuối tuần và số khách; `total_of_special_requests` bị loại vì người dùng có thể thao túng trực tiếp. Target là ADR chia median ADR theo loại phòng chỉ từ partition train. Trước khi ghi artifact, model phải có ADR MAE tốt hơn baseline mùa/ngày; chỉ dùng `--allow-baseline-regression` cho thí nghiệm có chủ đích.

Artifact mặc định là `random_forest_v2`, run `dc2e163f5cd9b29d`: trên holdout tương lai có ADR MAE `26.564856`, RMSE `33.676213`, R² `0.302843`, MAPE `0.214552` và tốt hơn baseline ADR MAE `4,45%`. Benchmark cùng population cho thấy ADR MAE giảm từ `32.114784` của v1 xuống `26.553508` ở thiết kế v2 room-normalized, khoảng `17,32%`. Đây vẫn là model học giá lịch sử, chưa phải bộ tối ưu doanh thu; metric/version/run chính xác luôn có tại `GET /api/v1/ai/model-info`, file sidecar và [báo cáo benchmark](2_ai_pricing_service/app/models/feature_v2_benchmark.json).

Build local:

```powershell
Set-Location ..\3_backend_core
npm run build

Set-Location ..\4_frontend_nextjs
npm run build
```

## Continuous Integration

Workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) chạy khi push, pull request hoặc kích hoạt thủ công. Ba job đầu kiểm tra độc lập backend (build/audit), frontend (typecheck/build/audit) và image AI (25 pytest). Job integration chỉ chạy sau khi cả ba job trên đạt, dựng một Docker stack cùng database/volume tạm, chạy `npm run test:all`, in log chẩn đoán nếu lỗi và luôn `docker compose down -v` khi kết thúc.

CI chỉ có quyền đọc source, không dùng secret triển khai và tạo `.env` dùng một lần ngay trên runner. Các dependency Node được cài bằng lockfile qua `npm ci`.

## Database và migration

Database chuẩn hóa **White Sand Boutique Hotel Đà Nẵng** được seed **6 hạng phòng** (`Superior Room` → `Studio Apartment`) và **54 phòng vật lý** (`301–1306`) cùng 5 mã ưu đãi trong `pricing_coupons` (`WHITESAND10`, `SUMMER15`, `DIFF2026`, `SUITE20`, `EXPIRED50`). `Demo Guest` là dữ liệu tham chiếu, không có mật khẩu đăng nhập mặc định. (Lưu ý: nếu máy host đã chạy sẵn PostgreSQL khác ở cổng `5432`, set `$env:POSTGRES_PORT='55432'` trước khi chạy `docker compose` hoặc script DB).

Các file trong `1_infrastructure/postgres/migrations` (`001` → `020`) chạy theo thứ tự trước backend. Migration là idempotent, backfill dữ liệu cũ, bổ sung snapshot/audit/version/index và dùng `ON DELETE RESTRICT` cho lịch sử quan trọng. `customer_account_audits` là nhật ký chỉ-ghi ở lớp ứng dụng cho thay đổi hồ sơ, mật khẩu, quyền và trạng thái. `payment_transactions` là ledger chỉ-ghi: hoàn tiền tạo dòng mới liên kết khoản thu gốc, không sửa/xóa lịch sử. `event_outbox` giữ event cùng transaction với aggregate và có partial index cho hàng chưa publish. Booking lưu `guest_count`, `checked_in_at/by` và `checked_out_at/by`; số khách được kiểm tra với capacity loại phòng trong transaction. `booking_create_requests` ánh xạ `(customer, Idempotency-Key)` tới đúng một booking và từ chối replay khác payload. `pricing_quotes` giữ immutable feature/giá/model/inventory snapshot cho mọi báo giá, mặc định bảo đảm giá 15 phút qua `PRICING_QUOTE_TTL_SECONDS`; khi booking dùng `quote_id`, quote được khóa và đánh dấu accepted trong cùng transaction. Migration `012` thêm event ledger và training view để nối quote với conversion, cancellation, completed stay và net payment mà không làm rò rỉ trạng thái tương lai vào feature snapshot. Migration `013` thêm shadow policy versioned, append-only attempt/decision/audit ledger, guardrail, readiness và cơ chế pause/rollback; migration không tự promote model. Các migration `014–020` bổ sung khóa toàn vẹn turnover/housekeeping, workflow giữ phòng `Pending`, role `hotelai_runtime` hạn chế quyền, Smart Room Upgrade, loyalty tier, và đồng bộ danh mục White Sand Đà Nẵng (`declared_max_price` + `pricing_coupons`). `daily_pricing_logs` lưu model, training-run và feature-contract version để truy vết quyết định AI. Phòng chỉ được gắn tối đa một `occupancy_booking_id`. Xóa phòng hoặc loại phòng đang được tham chiếu trả `409`; chuyển phòng sang `Maintenance` cũng trả `409` nếu ảnh hưởng booking `Confirmed` hoặc `CheckedIn`.

Dashboard gọi `booking_value` là tổng giá trị booking chưa hủy. Doanh thu tiền mặt thực tế cần lấy từ payment ledger (tổng `Payment` trừ `Refund`), không đồng nhất với giá trị booking.

## Lưu ý triển khai

- Dùng HTTPS và đặt `COOKIE_SECURE=true`.
- Thay toàn bộ secret mặc định và không commit `.env`.
- Cấu hình `CORS_ORIGINS` đúng domain thật.
- Dùng rate-limit store dùng chung nếu chạy nhiều backend replica.
- Thiết lập retention cho các dòng outbox đã publish và Kafka topic theo yêu cầu lưu trữ thực tế.
- Consumer Kafka phải lưu `event_id` đã xử lý hoặc dùng inbox table để chống xử lý trùng.
- Thiết lập backup/restore PostgreSQL và giám sát health/log trước khi đưa vào production.
