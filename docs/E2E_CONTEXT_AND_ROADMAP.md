# HotelAI — Tài Liệu Ngữ Cảnh & Lộ Trình Hoàn Thiện End-to-End

> **Mục đích:** Điểm neo ngữ cảnh dùng chung giữa các phiên làm việc dài. **Mọi phiên mới hoặc khi bắt đầu làm 1 tính năng E2E đều PHẢI đọc hết tài liệu này trước**, sau đó đối chiếu code liên quan, triển khai, kiểm thử và **cập nhật lại trạng thái + bằng chứng ở Mục 4–6 trước khi kết thúc**.

---

## 1. Quy Trình Bắt Buộc Khi Làm Từng Tính Năng E2E (Session Protocol)

1. **Đọc trước khi sửa:** Đọc toàn bộ file này + các file được liệt kê ở Feature Wave đang chọn. Không giữ giả định từ trí nhớ cũ nếu có thể xác minh nhanh trong code.
2. **Định nghĩa "Hoàn thành E2E" của 1 tính năng:**
   - Phải đi xuyên đủ **4 lớp**: UI (`4_frontend_nextjs`) ↔ API/Business Logic (`3_backend_core`) ↔ AI/Solver nếu có (`2_ai_pricing_service`) ↔ PostgreSQL (`1_infrastructure`) + đồng bộ state/làm mới dữ liệu thực.
   - Không tạo nút/trường "trang trí", không hardcode kết quả giả khi hệ thống đã có API/DB thật.
3. **Kiểm chứng bắt buộc sau mỗi wave:**
   - `3_backend_core`: `npx tsc --noEmit` + `npm run build` + các `.cjs`/`.mjs` regression liên quan.
   - `4_frontend_nextjs`: `npx tsc --noEmit` + toàn bộ unit checks (`scripts/*.cjs`) + `npm run build` / build container nếu đổi code runtime.
   - `2_ai_pricing_service`: `pytest --basetemp=<scratch>` cho module liên quan (khi chạm Python).
   - **Dọn DB sạch sau test:** Không để lại tài khoản, booking, coupon count, quote rác trong `hotel_db` (luôn kiểm tra `room_types=6`, `rooms=54`, `customers=8`, `pricing_coupons=5`, `used_count=0`).
4. **Cập nhật tài liệu:** Chuyển badge trạng thái ở Mục 4, đánh dấu checkbox ở Mục 5, ghi ngày + lệnh đã pass vào Mục 6.

---

## 2. Ngữ Cảnh Nền Bất Biến (System Ground Truth)

### 2.1. Danh tính mô phỏng — Option A: White Sand Boutique Hotel Đà Nẵng
- **Khách sạn:** White Sand Boutique Hotel (`89-91 Võ Văn Kiệt, P. An Hải, Q. Sơn Trà, TP. Đà Nẵng`, 15 tầng; sảnh/lễ tân 1F, hồ bơi/gym 2F, 54 phòng 3F–13F, nhà hàng 14F, spa 15F).
- **Danh mục 6 hạng & 54 phòng vật lý (`1_infrastructure/postgres/seed.sql` + `migrations/020_*`):**

| `type_id` | Hạng phòng | Giá cơ sở / đêm | Trần kê khai (`declared_max_price`) | Sức chứa | Số phòng (Tầng / Mã) |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | Superior Room | 1,200,000 VND | 1,550,000 VND | 2 | 12 (`301–406`) |
| 2 | Deluxe Room | 1,400,000 VND | 1,700,000 VND | 2 | 12 (`501–606`) |
| 3 | Premium Room | 1,600,000 VND | 1,850,000 VND | 4 | 8 (`701–804`) |
| 4 | Executive Room | 1,700,000 VND | 2,000,000 VND | 2 | 8 (`901–1004`) |
| 5 | Suite | 1,800,000 VND | 2,150,000 VND | 3 | 8 (`1101–1204`) |
| 6 | Studio Apartment | 2,000,000 VND | 2,300,000 VND | 4 | 6 (`1301–1306`) |

- **5 Coupon chuẩn trong bảng `pricing_coupons` (Migration `020`):**
  - `WHITESAND10`: giảm 10%, tối đa 300,000 VND/đêm, mọi hạng (`min_room_type_id=1`), limit `200`, active `TRUE`.
  - `SUMMER15`: giảm 15%, tối đa 450,000 VND/đêm, mọi hạng (`1`), limit `150`, active `TRUE`.
  - `DIFF2026`: giảm 12%, tối đa 400,000 VND/đêm, mọi hạng (`1`), limit `120`, active `TRUE`.
  - `SUITE20`: giảm 20%, tối đa 600,000 VND/đêm, chỉ `Suite` & `Studio Apartment` (`min_room_type_id=5`), limit `100`, active `TRUE`.
  - `EXPIRED50`: giảm 50%, limit `50`, active `FALSE`, hết hạn `2025-12-31` (fixture kiểm thử từ chối coupon).
- **Bảo vệ biên đóng góp tối thiểu (`3_backend_core/src/modules/pricing/pricing.service.ts` L49):** `MIN_CONTRIBUTION_FLOOR_VND = 452,000 VND/đêm` (biến phí 350k + biên 50k + VAT 8% + SVC 5%).
- **Tài khoản & Scope đã dọn (Option A):**
  - DB hiện giữ **8 customers** có sẵn (lưu ý: `admin@test.com` và `user@test.com` đang có `role='admin'`, còn `admin@example.com` đang có `role='customer'`).
  - **4 route đã xóa vĩnh viễn (trả `404`):** `/destinations`, `/in-stay`, `/admin/market-pricing-lab`, `/admin/scenario-sandbox` (Sandbox đã gộp vào Tab 3 trên `/admin/revenue-simulator`). **Không khôi phục các route này.**

### 2.2. Nguyên Tắc Khoa Học & Guardrails (Tuyệt Đối Không Vi Phạm)
1. **Bảo toàn P0–P5 (`academic.py`, `/ai-experiment`, `/decision-lab`):** Không sửa mô hình ADR Random Forest / Cancellation Logistic Regression trên tập Portugal 2015–2017 (119k dòng) hay hợp đồng đặc trưng `V2 (2.0.0)`.
2. **Tách bạch 4 nguồn dữ liệu trong mọi báo giá & UI:**
   - `(A) ML_REAL_DATA`: Kết quả ML từ dữ liệu lịch sử thực.
   - `(B) SIMULATED_SYSTEM_STATE`: Tồn kho/lịch đặt/trạng thái phòng trong PostgreSQL nội bộ.
   - `(C) SIMULATED_ASSUMPTION`: Giả định mùa vụ, thời tiết, đối thủ, kịch bản nhu cầu.
   - `(D) BUSINESS_RULE`: Trần kê khai, điều kiện coupon, sàn biến phí, giải tối ưu Google OR-Tools CP-SAT.
3. **Không ngụy tạo tuyên bố:** Không coi model hủy phòng là mô hình willingness-to-pay; không tuyên bố ML đã học phản ứng giá thị trường Đà Nẵng khi chưa có nhãn thực nghiệm; không chế biến đặc trưng giả rồi gắn mác AI thật.

---

## 3. Kiến Trúc, Hạ Tầng & Các Bẫy Kỹ Thuật Cần Nhớ

- **Dịch vụ & Port nội bộ (`docker-compose.yml`):**
  - Nginx Gateway: `http://localhost` (port `80`) → Frontend `:3000`, Backend Core `/api/v1/core/*`, AI `/api/v1/ai/*`.
  - PostgreSQL (`hotel_db`): Container `:5432`, map ra host **`127.0.0.1:55432`** (do container ngoài `studyflow-postgres` đang chiếm cổng `5432`). **Khi chạy script từ Windows host luôn set `$env:POSTGRES_PORT='55432'`.**
  - Redis & Kafka (`outbox`): Cơ chế fail-open; catalog đọc fallback về PostgreSQL, domain event lưu transactional outbox.
  - DB role hạn chế quyền (`hotelai_runtime`, Migration `016` + `020`): không dùng owner cho runtime production, không `DELETE` ledger `bookings`/`payments`.
- **Các bẫy kỹ thuật đã gặp & quy ước sửa:**
  1. **TypeORM `UPDATE / DELETE ... RETURNING`:** `queryRunner.query(...)` mặc định trả `[rows, rowCount]` (mảng 2 phần tử), nên kiểm tra `.length === 1` sẽ **LUÔN FAIL** (`409 Conflict`). Bắt buộc truyền tham số thứ 3 `true` (`useStructuredResult = true`) và kiểm tra `.affected` (tham chiếu mẫu: `3_backend_core/src/modules/bookings/bookings.service.ts` L227–244).
  2. **Rate limit `/auth/register`:** `AuthController.register` chặn **`3 lần / 10 phút / IP`**. Script test nhiều vòng nên tái dùng account hoặc `--force-recreate backend_core` khi chạy suite tạo nhiều user.
  3. **Kiểm tra phòng trống theo ngày:** `GET /rooms` chỉ trả `available_now` hiện tại; số phòng trống theo kỳ `check_in_date..check_out_date` (`rooms_available`) **phải lấy từ `POST /pricing/quote`**.
  4. **Pytest trên Windows:** Luôn truyền `--basetemp=<scratch>` hoặc chạy pytest trong container `ai_service` để tránh lỗi permission lock thư mục Temp Windows.
  5. **PowerShell host:** Dùng `;` thay vì `&&`; thoát `$` cẩn thận khi viết inline script.

---

## 4. Ma Trận Trạng Thái End-to-End (Verified 2026-11-12)

> **Ký hiệu:**
> - `[DONE / VERIFIED E2E]`: Đã nối đủ Frontend ↔ Backend ↔ (AI) ↔ DB và có smoke/regression pass.
> - `[PARTIAL / GAP]`: Có phần chạy nhưng còn đứt gãy UI–API, lỗi unit check, hoặc thiếu luồng đóng vòng E2E.
> - `[API-ONLY / NO UI]`: Backend/AI & Migration DB đã làm xong, nhưng chưa có màn hình/công cụ trên Frontend.
> - `[TODO]`: Tài liệu lỗi thời hoặc kiểm thử trình duyệt thực tế chưa chạy.

| Mã | Phân hệ & Route | Trạng thái | Tệp chính | Vấn đề / Khoảng trống E2E còn lại |
| :---: | :--- | :---: | :--- | :--- |
| **M1** | Public Discovery (`/`, `/about`, `/rooms`, `/rooms/[id]`) | `[DONE / VERIFIED E2E]` | `4_frontend_nextjs/src/components/features/figma/{HomeView,AboutView}.tsx`, `rooms/*` | SSR, API & headless Chromium E2E trả đúng 6 hạng White Sand, toàn bộ ảnh `/images/whitesand/*` tải `naturalWidth > 0`. |
| **M2** | Đặt phòng, Báo giá 4-source, Coupon & Hủy (`/book`, `/checkout`, `/bookings`) | `[DONE / VERIFIED E2E]` | `BookView.tsx`, `CheckoutForm.tsx`, `GuestPriceExplanationCard.tsx`, `useReservation.ts`, `bookings.service.ts`, `pricing.service.ts` | Đã nối `IntersectionObserver` + `markQuoteVisible` trên cả `/book` & `/checkout`, kiểm chứng E2E trình duyệt thực tế luồng `EXPIRED50`/`WHITESAND10`, `quote.exposed.v1` idempotent, tạo & hủy booking trả phòng/coupon sạch sẽ. |
| **M3** | Tài khoản, Hồ sơ & Thông báo (`/login`, `/register`, `/profile`) | `[DONE / VERIFIED E2E]` | `AuthForm.tsx`, `ProfileManager.tsx`, `BookingHistory.tsx`, `AccountMenu.tsx`, `booking-workflow.controller.ts` (L108–129) | Auth, đăng ký UI, Profile, Loyalty Tier (`018`), Hộp thông báo khách hàng (`/bookings#notifications`) & badge chưa đọc trên `AccountMenu` đã xác minh full browser E2E. |
| **M4** | Trợ lý Chat AI SOP (`ChatWidget`) | `[DONE / VERIFIED E2E]` | `ChatWidget.tsx`, `3_backend_core/src/modules/chat/chat.service.ts` | Đã khớp tri thức White Sand (địa chỉ, 14F/15F/2F, pet policy, coupon hints, catalog DB thật, guard không bịa) và xác minh trả lời live trên trình duyệt. |
| **M5** | Academic ML Labs (`/ai-experiment`, `/decision-lab`) | `[DONE / VERIFIED E2E]` | `src/app/{ai-experiment,decision-lab}/page.tsx`, `academic.py`, `academic.controller.ts` | Đã kiểm chứng P0–P5; `academic-contract-regression.cjs`, `academic-http-integration.mjs` & browser E2E `/ai-experiment`, `/decision-lab` PASS. |
| **M6** | Admin Dashboard & Tồn kho điều hành (`/admin`) | `[DONE / VERIFIED E2E]` | `AdminDashboard.tsx`, `PricingIntelligencePanel.tsx`, `admin-operations.controller.ts` | Thống kê doanh thu/công suất thật, bảng tồn phòng theo đêm & hiển thị trình duyệt PASS. |
| **M7** | Admin Kho Phòng, Hạng & Giá Trần (`/admin/rooms`) | `[DONE / VERIFIED E2E]` | `AdminRoomsManager.tsx`, `admin-rooms.controller.ts` | Đã có cột & editor `declared_max_price`, bảo vệ `base_price <= declared_max_price`, khóa `Occupied`, xác minh browser E2E PASS. |
| **M8** | Admin AI Pricing, Settings, Shadow Control, Drift & Explain (`/admin/pricing`, `/admin/pricing/shadow/*`) | `[DONE / VERIFIED E2E]` | `AdminPricingManager.tsx`, `AiShadowControlPanel.tsx`, `AiDriftMonitorPanel.tsx`, `AdminExplainSamplePanel.tsx`, `AiPriceExplanation.tsx`, `admin-pricing.controller.ts`, `admin-ai-shadow.controller.ts`, `drift_monitor.py`, `tree_interpreter.py` | **Đã xong Wave 4 & Wave 5 browser E2E:** Nối đủ Control Settings `ai_enabled`, **Shadow Challenger & Readiness Control**, **AI Drift Monitoring** PSI từ PostgreSQL `pricing_quotes`, **Explain Price Sample inspector** & xác minh click-through PASS. |
| **M9** | Admin P8 Revenue Simulator, Coupon & OR-Tools (`/admin/revenue-simulator`) | `[DONE / VERIFIED E2E]` | `AdminRevenueSimulator.tsx`, `admin-coupons.*`, `revenue.*`, `revenue_decision_engine.py`, `constraint_room_allocator.py` | **Đã xong Wave 2, 3 & 5:** đồng bộ live `(A)` ML & `(B)` tồn kho thực, Admin CRUD `pricing_coupons`, thẻ **Thẩm định thị trường Đà Nẵng (`/revenue/market-decision`)**, Tab 2 OR-Tools Live & Tab 3 Sandbox xác minh click-through đủ 3 tab PASS. |
| **M10** | Admin Vận hành Lễ tân, Tape Chart, Buồng phòng & Policy (`/admin/bookings`, `/admin/tape-chart`, `/admin/housekeeping`) | `[DONE / VERIFIED E2E]` | `AdminBookingsManager.tsx`, `AdminTapeChart.tsx`, `HousekeepingOperationsManager.tsx`, `booking-workflow.controller.ts` | Check-in/out, Tape Chart, Reassign, Housekeeping `Dirty→Cleaning→Ready`, Smart Upgrade, No-Show, **Chính sách giữ phòng & Quét hết hạn**, **Confirm / Credit-Authorization** đều đã xác minh browser E2E PASS. |
| **M11** | Admin Thanh toán & Người dùng (`/admin/payments`, `/admin/users`) | `[DONE / VERIFIED E2E]` | `AdminPaymentsManager.tsx`, `AdminUsersManager.tsx`, `payments/*`, `admin-users.*` | Ghi nhận thanh toán, hoàn tiền theo giao dịch gốc, RBAC + Audit user & hiển thị trình duyệt PASS. |
| **M12** | Tài liệu Demo & Browser E2E Suite | `[DONE / VERIFIED E2E]` | `docs/AI_REVENUE_DEMO_VI.md`, `README.md`, `4_frontend_nextjs/src/app/icon.svg`, `4_frontend_nextjs/public/favicon.ico` | **Đã xong Wave 5:** Đồng bộ sạch 100% tài liệu về **White Sand Boutique Hotel Đà Nẵng** & `http://localhost`, thêm `icon.svg`/`favicon.ico` sạch `404`, xác minh headless Chromium đủ 21 route sống + 4 route `404` đã xóa (13/13 checks PASS, 0 console/JS error). |

---

## 5. Lộ Trình Hoàn Thiện End-to-End Theo Từng Feature Wave

> Mỗi Wave nhỏ, độc lập, có mục tiêu E2E rõ ràng để triển khai gọn trong 1 phiên làm việc.

- [x] **Wave 1 — Khắc phục trọn vẹn Luồng Khách Đặt Phòng & Quote Telemetry (`M2`, `M3`)**
  - **Việc cần làm:**
    1. [x] Sửa `useReservation.ts` & `BookView.tsx`: gắn `IntersectionObserver` + `markQuoteVisible` cho khối giá/summary ở `/book` giống `CheckoutForm.tsx` (hỗ trợ cả `typeof document === 'undefined'` an toàn và đồng bộ `useReservation.ts` + `reservation-hooks-unit-check.cjs` theo thiết kế exposure thật).
    2. [x] Bảo đảm `node scripts/reservation-hooks-unit-check.cjs` **PASS** (đạt **12/12** unit checks frontend).
    3. [x] Nối UI hiển thị **Thông báo đặt phòng (`GET /users/me/notifications` & `PATCH .../read`)** cho khách đã đăng nhập (trên `/bookings#notifications` và menu user `AccountMenu` của `PublicShell`).
    4. [x] Xác minh luồng `/rooms` → `/book` & `/checkout` → áp `WHITESAND10`/`SUITE20`/`EXPIRED50` → `quote.exposed.v1` → đặt phòng → thông báo + đánh dấu đã đọc → hủy phòng trả tồn kho/coupon.

- [x] **Wave 2 — Hoàn thiện P8 Revenue Simulator & Quản trị Coupon (`M9`)**
  - **Việc cần làm:**
    1. [x] Thay `ml_multiplier: 1.12` cứng tại `AdminRevenueSimulator.tsx` bằng giá trị live từ `GET /revenue/live-context` (`AI /api/v1/predict-price`) theo `room_type_id` + `check_in_date..check_out_date` (kèm nút ghi đè thủ công, phân tách rõ nhãn `(A) ML Live` vs `(C) Ghi đè`).
    2. [x] Thêm đồng bộ tồn kho DB thực (`rooms_available` / `rooms_sellable` theo `checkInDate..checkOutDate`, không tạo `pricing_quotes` rác) trên Tab 1 kèm toggle **Đồng bộ DB `[B]` / What-If `[C]`**.
    3. [x] Thêm **Admin Coupon Management CRUD** (`GET/POST/PATCH /admin/coupons` + UI quản lý `pricing_coupons`: tạo/sửa mã, bật/tắt `active`, hạn dùng, `min_room_type_id`, `usage_limit`, reset `used_count`) & nối Engine AI đọc quy tắc coupon thực từ PostgreSQL — đồng bộ tức thời với `/book`, `/checkout` và Simulator.
    4. [x] Thêm panel chỉnh **`custom_scenario`** (`serving_cost`, `channel_commission_pct`, `tax_rate`, `service_charge_rate`, `demand_level`, `weather`, `competitor_rate_position`) gửi trực tiếp xuống `POST /revenue/decision` và hiển thị động trên P&L.
    5. [x] Nối **`POST /revenue/market-decision`** lên Tab 1 Simulator (thẻ **Thẩm định thị trường Đà Nẵng từ nguồn công khai** gắn nhãn Advisory Only, hiển thị `status`, `blockers`, nguồn Open-Meteo/sự kiện, tham chiếu `[A] ML`) và sửa quyền ghi `/app/.tmp` trong container `ai_service` + timeout Nginx `55s`.

- [x] **Wave 3 — Khép kín Vòng Vận Hành: Booking Policy, Pending Expiry & OR-Tools Thực Tế (`M10`, `M9`)**
  - **Việc cần làm:**
    1. [x] Tạo panel **Chính sách giữ phòng & Quét hết hạn** trên `/admin/bookings` (gọi `GET/PATCH /admin/booking-policy` & nút chạy `POST /admin/workflow/expire`) và modal `confirm` / `credit-authorization` để kiểm soát `Pending` TTL/deposit & bảo lãnh checkout ngay trên giao diện.
    2. [x] Kết nối Tab 2 OR-Tools Live với **danh sách booking đang chờ / chưa tối ưu phòng thực** (`GET /admin/allocations/queue` → `POST /admin/allocations/optimize-queue` → `POST /admin/bookings/:id/reassign-room`) và liên kết sang `HousekeepingOperationsManager` có xác nhận an toàn, ghi ledger đầy đủ.

- [x] **Wave 4 — Giao Diện Quản Trị AI Shadow & Drift Monitoring (`M8`)**
  - **Việc cần làm:**
    1. [x] Trên `/admin/pricing`, bổ sung section **Shadow Challenger & Readiness** (`AiShadowControlPanel.tsx`) nối `GET /admin/pricing/shadow/settings`, `readiness`, `audits`, `runtime-status`, `PUT .../settings`, `POST .../pause`, `POST .../rollback` (hiển thị rõ `causality_warning` & 6 gate từ view `ai_pricing_shadow_readiness_v1`, không mở nút ép promote).
    2. [x] Bổ sung widget **AI Drift Monitoring** (`AiDriftMonitorPanel.tsx`) nối `GET /admin/pricing/drift-monitoring` → AI `POST /api/v1/monitoring/drift` tính PSI từ dữ liệu PostgreSQL `pricing_quotes` thực, cảnh báo phân phối đầu vào & domain shift.
    3. [x] Bổ sung **Explain Price Sample Inspector** (`AdminExplainSamplePanel.tsx` nối `POST /admin/pricing/explain-sample` → AI `/api/v1/explain-price`, xử lý an toàn `503` khi model tắt) và tinh chỉnh `AiPriceExplanation.tsx` giữ trung thực nguồn `(A) Portugal V2` + `Saabas Tree Interpreter`.

- [x] **Wave 5 — Đồng Bộ Tài Liệu & Kiểm Thử Trình Duyệt End-to-End Toàn Hệ Thống (`M12`)**
  - **Việc cần làm:**
    1. [x] Cập nhật `docs/AI_REVENUE_DEMO_VI.md` và `README.md` đúng tên khách sạn **White Sand Boutique Hotel Đà Nẵng**, hạng phòng `Superior Room..Studio Apartment`, coupon `WHITESAND10/SUMMER15/SUITE20/DIFF2026/EXPIRED50`, port `http://localhost` (không còn `Aurum`, `Deluxe King`, `AURUM10`, `DUMP90`, `53014`, `/admin/scenario-sandbox`).
    2. [x] Chạy full automated suite (AI pytest `273/273` + Backend `4/4` `.cjs` & 5 HTTP integrations + Frontend `13/13` `.cjs` + `npm run build`).
    3. [x] Chạy Browser E2E click-through toàn bộ 21 route công khai & admin + 4 route `404` đã xóa, xác nhận zero console error, zero `404`/`500` bất thường, bổ sung `icon.svg`/`favicon.ico` sạch `404`, dọn sạch DB sau kiểm thử.

- [x] **Endgame E1–E5 — Nâng Cấp AI Chạm Trần 5 Trụ Cột (`M4`, `M8`, `M9`)**
  - **Việc cần làm:**
    1. [x] **E1 — Split Conformal Prediction 90% + Mahalanobis OOD Gate + Empirical Portugal V2 Drift Baseline:** Bổ sung `2_ai_pricing_service/app/core/conformal_ood.py`, `2_ai_pricing_service/app/api/endpoints/pricing.py` (`POST /api/v1/predict-price` kèm dải Conformal `[q_lo, q_hi]` và điểm OOD Mahalanobis), nâng cấp `drift_monitor.py` & `AdminPricingManager.tsx` / `AiDriftMonitorPanel.tsx` / `AdminExplainSamplePanel.tsx`.
    2. [x] **E2 — Live Grounded Đà Nẵng Native NLP (`native_vn_nlp_v1`) & Open-Meteo Comfort Index:** Xây dựng `2_ai_pricing_service/app/services/danang_nlp_signal.py` chấm điểm tín hiệu sự kiện/du lịch/thời tiết Đà Nẵng không cần LLM ngoài, nối vào `/revenue/market-decision` và hiển thị trực tiếp trên Tab 1 `AdminRevenueSimulator.tsx`.
    3. [x] **E3 — OR-Tools CP-SAT Multi-Night 6-Tier Portfolio Yield, 1-Tier Upgrades & Shadow Prices:** Bổ sung `2_ai_pricing_service/app/services/portfolio_yield_optimizer.py` (`POST /api/v1/revenue/portfolio-optimize`), `POST /api/v1/core/revenue/portfolio-optimize` đọc tồn kho 6 hạng × từng đêm từ PostgreSQL, cùng card Portfolio Optimizer + ma trận giá/đêm & shadow price trên Tab 2 `AdminRevenueSimulator.tsx`.
    4. [x] **E4 — Guardrailed Thompson Sampling Bandit Lab & Conversion Taxonomy Drift Audit:** Bổ sung `2_ai_pricing_service/app/services/bandit_pricing_lab.py` (`GET /api/v1/revenue/taxonomy-audit`, `POST /api/v1/revenue/bandit-simulate`), `POST /api/v1/core/revenue/bandit-simulate` và `BanditPolicyLabPanel.tsx` trên `/admin/pricing` (chứng minh 0.0% overlap giữa `conversion_challenger_v1` và 6 hạng phòng White Sand, khóa an toàn tuyệt đối không promote tự động).
    5. [x] **E5 — Hybrid BM25 + TF-IDF Bilingual RAG & Live Tool-Calling White Sand Assistant:** Bổ sung `2_ai_pricing_service/app/services/concierge_rag.py` + `POST /api/v1/concierge/ask`, nâng cấp `ChatService.processRichMessage()` + `ChatController` (`pg_live_inventory_availability` & `pg_coupon_quota_lookup` read-only, 0 ghi `pricing_quotes`) và `ChatWidget.tsx` (chip trích dẫn `[doc_id]`, badge `LIVE DB`, nút CTA deep-link `/book?...`).

---

## 6. Bộ Lệnh Kiểm Thử Chuẩn & Nhật Ký Baseline

### Lệnh kiểm thử chuẩn
```powershell
# 1. Build kiểm tra TypeScript / NestJS
cd e:\hotelAI\3_backend_core; npx tsc --noEmit; npm run build

# 2. Backend contract & intelligence regressions (chạy trên host, không cần DB)
cd e:\hotelAI\3_backend_core
node scripts/pricing-contract-regression.cjs
node scripts/academic-contract-regression.cjs
node scripts/chat-guidance-regression.cjs
node scripts/pricing-intelligence-regression.cjs

# 3. Frontend unit checks (13 files tại 4_frontend_nextjs/scripts/*.cjs)
cd e:\hotelAI\4_frontend_nextjs; Get-ChildItem scripts\*.cjs | ForEach-Object { node $_.FullName }

# 4. Docker E2E & Smoke Tests (Nhớ set POSTGRES_PORT=55432 do studyflow-postgres giữ 5432)
cd e:\hotelAI\3_backend_core; $env:POSTGRES_PORT='55432'
node --env-file=..\.env scripts/verify-revenue-suite.cjs
node --env-file=..\.env scripts/revenue-http-integration.mjs
node --env-file=..\.env scripts/public-journey-smoke-test.mjs
# Lưu ý: admin-smoke-test.mjs tạo 3 account mới -> chú ý giới hạn 3 req/10m của /auth/register
node --env-file=..\.env scripts/admin-smoke-test.mjs

# 5. AI Service Pytest (tránh Windows temp permission lock)
cd e:\hotelAI\2_ai_pricing_service; pytest --basetemp=C:\Temp\pytest-hotelai
```

### Nhật ký cập nhật gần nhất
- **2026-11-12 (Baseline trước Wave 1):**
  - Đã sửa lỗi `POST /bookings` có coupon trả `409 Conflict` trong `3_backend_core/src/modules/bookings/bookings.service.ts` L227–244 (`useStructuredResult = true`, kiểm tra `affected !== 1`).
  - Đã thêm `ortools==9.15.6755` vào `2_ai_pricing_service/requirements.txt` và rebuild Docker stack.
  - **Kết quả đo thực tế:** `3_backend_core` build PASS; 4/4 backend `.cjs` regression PASS; `verify-revenue-suite.cjs` 6/6 PASS; `revenue-http-integration.mjs` PASS; `public-journey-smoke-test.mjs` PASS; `admin-smoke-test.mjs` PASS; White Sand E2E verification 6/6 blocks PASS (`rooms_available` `12->11->12`, `WHITESAND10` `used_count` `0->1->0`). DB sạch: `room_types=6`, `rooms=54`, `customers=8`, `pricing_coupons=5`, `used_count=0`, `temp_quotes_today=0`.
  - **Tồn đọng đã ghi nhận để làm Wave 1:** `4_frontend_nextjs/scripts/reservation-hooks-unit-check.cjs` đang fail tại dòng 167 & `BookView.tsx` chưa gắn `markQuoteVisible`.
- **2026-11-12 (Hoàn tất Wave 1 — `M2`, `M3`):**
  - Cập nhật `4_frontend_nextjs/src/hooks/useReservation.ts`, `CheckoutForm.tsx`, `BookView.tsx` (gắn `IntersectionObserver` + `markQuoteVisible` + `visibilitychange` an toàn khi SSR/Node); bổ sung hộp thông báo khách hàng tại `BookingHistory.tsx` (`#notifications`) và badge chưa đọc tại `AccountMenu.tsx` + `booking.service.ts` (`getOwnNotifications`, `markOwnNotificationRead`).
  - **Kết quả kiểm chứng Wave 1:** `4_frontend_nextjs` `npx tsc --noEmit` PASS; **12/12** `4_frontend_nextjs/scripts/*.cjs` PASS (bao gồm `reservation-hooks-unit-check.cjs` & `booking-service-unit-check.cjs`); `npm run build` PASS (`23/23` routes); rebuild `hotelai-frontend_nextjs-1` healthy; Live E2E qua `http://localhost` PASS toàn bộ. DB sạch: `room_types=6, rooms=54, customers=8, pricing_coupons=5, total_coupon_used=0, bookings=1259, notifications=1255`.
- **2026-11-12 (Hoàn tất Wave 2 — `M9`: P8 Simulator Live + Admin Coupon CRUD + Đà Nẵng Market Decision):**
  - AI Service (`2_ai_pricing_service`): cập nhật `revenue_schema.py`, `revenue_decision_engine.py`, `endpoints/revenue.py` để ưu tiên quy tắc coupon từ PostgreSQL (`coupon_rule` + `coupon_lookup_performed`), giữ `min_room_type_id`/`expiry_date` chuẩn `UTC+7`; tạo thư mục `/app/.tmp/*` cho `appuser` trong `Dockerfile`.
  - Backend Core (`3_backend_core`): bổ sung `GET /revenue/live-context` (chỉ đọc DB + gọi AI `/predict-price` fail-open, 0 quote rác), sửa `evaluateQuote` truy vấn `pricing_coupons`, bổ sung `AdminCouponsController`/`Service` (`GET/POST /admin/coupons`, `PATCH /admin/coupons/:code`), tăng `proxy_read_timeout 55s` cho `/revenue/market-decision` trong `nginx.conf`.
  - Frontend (`4_frontend_nextjs`): cập nhật `revenue.type.ts`, `revenue.service.ts`, `AdminRevenueSimulator.tsx` (đồng bộ `(A)` ML & `(B)` DB real-time kèm toggle override `(C)`, UI CRUD coupon PostgreSQL, editor `custom_scenario` + P&L động VAT/SVC/OTA, thẻ thẩm định công khai Đà Nẵng).
  - **Kết quả kiểm chứng Wave 2:** AI `pytest` **270/270 PASS**; `3_backend_core` `tsc`, `4/4` `.cjs` regression & `npm run build` PASS; `4_frontend_nextjs` `tsc`, **12/12** `.cjs` & `npm run build` PASS; Docker live suite (`verify-revenue-suite.cjs` 6/6 PASS, `revenue-http-integration.mjs` 7/7 PASS, `market-pricing-http-integration.mjs` PASS với 5/5 nguồn Đà Nẵng `fetched`, `wave2_e2e_verify.mjs` 6/6 PASS). DB sạch: `room_types=6, rooms=54, customers=8, pricing_coupons=5, total_coupon_used=0, bookings=1259, notifications=1255`.
- **2026-11-12 (Hoàn tất Wave 3 — `M10`, `M9`: Booking Policy, Pending Expiry, Credit Auth & OR-Tools Queue Live):**
  - AI Service & Backend Core: `GET/PATCH /admin/booking-policy`, `GET /admin/workflow/readiness`, `POST /admin/workflow/expire`, `POST /admin/bookings/:id/confirm`, `POST /admin/bookings/:id/credit-authorization`, `GET /admin/allocations/queue`, `POST /admin/allocations/optimize-queue`, `POST /admin/bookings/:id/reassign-room`.
  - Frontend (`4_frontend_nextjs`): hoàn thiện panel **Chính sách giữ phòng & Quét hết hạn**, nút Xác nhận/Ủy quyền thẻ trước Checkout trên `AdminBookingsManager.tsx`, và nối Tab 2 OR-Tools Live trên `AdminRevenueSimulator.tsx` trực tiếp với hàng đợi booking thực PostgreSQL + áp dụng ghi ledger có xác nhận.
  - **Kết quả kiểm chứng Wave 3:** AI `pytest` **272/272 PASS**; `4_frontend_nextjs` `tsc`, **12/12** `.cjs` (`lifecycle-unit-check.cjs` PASS) & `npm run build` (`23/23` routes) PASS; Docker rebuild & live suite (`verify-revenue-suite.cjs` 6/6 PASS, `revenue-http-integration.mjs` 7/7 PASS, `public-journey-smoke-test.mjs` PASS, `room-turnover-smoke-test.mjs` PASS, `wave3_e2e_verify.mjs` EXIT 0 PASS). DB sạch: `room_types=6, rooms=54, customers=8, pricing_coupons=5, coupon_used=0, bookings=1259, notifications=1255, assign_events=2, credit_auths=0`, `booking_policies v1`.
- **2026-11-12 (Hoàn tất Wave 4 — `M8`: AI Shadow Control, Drift Monitoring PSI & Explain Price Review):**
  - AI Service (`2_ai_pricing_service`): bổ sung `app/core/drift_monitor.py`, `app/core/tree_interpreter.py`, endpoint `POST /api/v1/monitoring/drift` & `POST /api/v1/explain-price` tại `app/api/endpoints/pricing.py` cùng unit tests (`test_drift_monitor.py`, `test_tree_interpreter.py`).
  - Backend Core (`3_backend_core`): cập nhật `pricing-intelligence.dto.ts`, `admin-pricing-intelligence.service.ts`, `admin-pricing.controller.ts`, `admin-ai-shadow.service.ts`, `admin-ai-shadow.controller.ts` (bổ sung `GET /admin/pricing/shadow/runtime-status`, `GET /admin/pricing/drift-monitoring`, `POST /admin/pricing/explain-sample`), cập nhật `scripts/pricing-intelligence-regression.cjs`.
  - Frontend (`4_frontend_nextjs`): cập nhật `admin.type.ts`, `admin.service.ts`, refactor `AiPriceExplanation.tsx` (bỏ copy sai sự thật & style JSX inline), tạo `AiShadowControlPanel.tsx`, `AiDriftMonitorPanel.tsx`, `AdminExplainSamplePanel.tsx`, nhúng vào `AdminPricingManager.tsx` và thêm `scripts/ai-shadow-drift-unit-check.cjs`.
  - **Kết quả kiểm chứng Wave 4:** AI `pytest` **273/273 PASS** (`10.93s`); `3_backend_core` `tsc`, `npm run build`, **4/4** `.cjs` regression (`pricing-intelligence-regression.cjs` 15/15) PASS; `4_frontend_nextjs` `tsc`, **13/13** `.cjs`, `npm run build` (`23/23` routes) PASS; Live Docker E2E (`wave4_e2e_verify.mjs`) **6/6 PASS** (`drift 500/2325 quotes`, `explain-sample HTTP 201`, shadow `400/409` guardrails, canonical idempotency). DB sạch: `room_types=6, rooms=54, customers=8, pricing_coupons=5, coupon_used=0, bookings=1259, notifications=1255, pricing_quotes=2325, assign_events=2, credit_auths=0`, `ai_pricing_shadow_settings setting_id=1, shadow_enabled=false, version=1`.
- **2026-11-12 (Hoàn tất Wave 5 — `M12`: Docs Sync & Full 21-Route Headless Browser E2E):**
  - Tài liệu & Asset (`docs/AI_REVENUE_DEMO_VI.md`, `README.md`, `4_frontend_nextjs/src/app/icon.svg`, `4_frontend_nextjs/public/favicon.ico`): đồng bộ 100% kịch bản demo, endpoint và hạng phòng **White Sand Boutique Hotel Đà Nẵng** (`http://localhost`, không còn `Aurum`, `AURUM10`, `DUMP90`, `53014`, `Deluxe King`, `/admin/scenario-sandbox`); bổ sung favicon xử lý sạch `404 /favicon.ico`.
  - **Kết quả kiểm chứng Wave 5:** AI `pytest` **273/273 PASS** (`10.64s`); `3_backend_core` `tsc`, `npm run build`, **4/4** `.cjs` regression (`pricing-intelligence-regression.cjs` 15/15) PASS + **5/5** live integration suite qua Nginx `http://localhost` PASS (`verify-revenue-suite.cjs` 6/6, `revenue-http-integration.mjs` 7/7, `market-pricing-http-integration.mjs` 5 nguồn Đà Nẵng, `academic-http-integration.mjs`, `public-journey-smoke-test.mjs` `12->11->12`); `4_frontend_nextjs` `tsc`, **13/13** `.cjs`, `npm run build` (`24/24` app routes gồm `/icon.svg`) PASS; Headless Chromium CDP E2E (`wave5_browser_e2e.mjs`) **13/13 checks PASS** qua toàn bộ **21 route sống** + **4 route `404` đã xóa** (`/`, `/about`, `/rooms`, `/rooms/1` + `ChatWidget` + ảnh, `/ai-experiment`, `/decision-lab`, `/book`, `/register`, `/checkout` `EXPIRED50`/`WHITESAND10`, `/bookings#notifications` + hủy phòng, `/profile`, `/login` Admin, `/admin`, `/admin/tape-chart`, `/admin/bookings`, `/admin/housekeeping`, `/admin/payments`, `/admin/rooms`, `/admin/users`, `/admin/pricing` Shadow/Drift/Explain, `/admin/revenue-simulator` cả 3 tab), zero JS/console errors, zero unexpected HTTP `>=400`. DB sạch tuyệt đối: `room_types=6, rooms=54, customers=8, pricing_coupons=5, coupon_used=0, bookings=1259, notifications=1255, pricing_quotes=2325, assign_events=2, credit_auths=0`, `ai_pricing_shadow_settings setting_id=1, shadow_enabled=false, version=1`.
- **2026-11-12 (Hoàn tất Endgame AI E1–E5 — Chạm Trần 5 Trụ Cột Thuần Bản Địa):**
  - **E1:** Split Conformal 90% + Mahalanobis OOD Gate + Empirical Portugal V2 Drift Baseline nối qua `/api/v1/core/admin/pricing/explain-sample` & `.../drift-monitoring` lên `/admin/pricing`.
  - **E2:** Native Python `native_vn_nlp_v1` + Open-Meteo Comfort Index trên `/revenue/market-decision` và Tab 1 `AdminRevenueSimulator.tsx`.
  - **E3:** OR-Tools CP-SAT 6-tier multi-night Portfolio Yield (`FEASIBLE`, +15.27% simulated lift trên horizon 5 đêm, 1-tier upgrade + marginal shadow prices VND/room) nối lên Tab 2 `AdminRevenueSimulator.tsx`.
  - **E4:** Guardrailed Thompson Sampling Bandit Lab (`BanditPolicyLabPanel.tsx` trên `/admin/pricing`) đạt 100% guardrail safety (so sánh với `unconstrained_epsilon_greedy`) và audit `conversion_challenger_v1` xác nhận 0.0% overlap với 6 hạng phòng White Sand (`has_taxonomy_drift=true`, `promotion_allowed=false`).
  - **E5:** Hybrid BM25 + TF-IDF RAG (`concierge_rag.py` `hybrid_bm25_tfidf_v1`, 8 SOP song ngữ `WS-LOC-01..WS-PRV-08`) + trích xuất slot (`room_type_id`, ngày, số đêm, số khách, coupon) + tool-calling read-only PostgreSQL (`pg_live_inventory_availability`, `pg_coupon_quota_lookup`) + citation chip & deep-link `/book?...` trong `ChatWidget.tsx`.
  - **Kết quả kiểm chứng cuối (2026-11-12):** AI `pytest` **287/287 PASS** (`18.39s`); `3_backend_core` `tsc`, `npm run build`, **4/4** standalone `.cjs` + live `revenue-http-integration.mjs` (7/7) & `market-pricing-http-integration.mjs` (5/5 nguồn Đà Nẵng `fetched`) PASS; `4_frontend_nextjs` `tsc`, **13/13** `.cjs`, `npm run build` (`24/24`) PASS; Live Docker + Headless Chromium CDP (`e1_live_verify.mjs` .. `e5_live_verify.mjs`) **E1–E5 đều EXIT 0 PASS** (`CORE: ok`, `AI: ok`; DB sạch: `room_types=6, rooms=54, customers=8, pricing_coupons=5, coupon_used=0, bookings=1259, pricing_quotes=2327`).


