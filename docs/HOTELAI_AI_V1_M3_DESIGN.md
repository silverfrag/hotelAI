# M3 — thiết kế để duyệt trước sửa booking/migration

Trạng thái: **chờ người dùng duyệt**. Đọc cùng `HOTELAI_AI_V1_PLAN.md`. Bản này chỉ là thiết kế; chưa sửa booking hoặc tạo migration. M2 được phép tiếp tục độc lập. Ngày: 2026-11-07; run `20261029-092250`.

## 1. Những bất biến cần giữ

- Backend quyết định lịch, tồn phòng, giá chính sách và ràng buộc từng đêm. Trình duyệt chỉ gửi loại phòng, ngày, số khách và mã quote; không gửi URL thu thập hoặc vector đặc trưng đáng tin cậy.
- Quote có TTL 30 phút; giá/đầu vào/lineage bất biến. Booking xác nhận tồn phòng trong transaction hiện có, dùng tổng đã lưu; không gọi lại AI hay tính lại giá theo cấu hình mới.
- Giữ advisory lock theo loại phòng, khóa quote, kiểm tra sức chứa/overlap, idempotency và transactional outbox hiện có. Không biến quote thành giữ phòng.
- V1 chỉ phục vụ giá chính sách. AI đạt gate chỉ tạo quyết định shadow. Model chưa sẵn sàng/timeout/sai contract/coverage thiếu: xác suất là `null`, nguồn `policy`, lý do cụ thể.
- Nhánh collector (a) đã duyệt: contract `stay-market-v1-no-competitors`; không điền số trung tính hoặc nạp artifact yêu cầu giá đối thủ.
- Không sửa file migration đã áp dụng; không xóa/backfill lịch sử hoặc đổi giá booking cũ. Migration mới chỉ chạy DB demo, sau backup kiểm chứng.

## 2. Kết quả đọc ứng dụng hiện có

| Vị trí | Hiện trạng | Thay đổi cần duyệt |
|---|---|---|
| `pricing.service.ts` | Một giá đêm nhân số đêm; source phụ thuộc cờ bật AI dù dịch vụ AI có thể lỗi | Giá từng đêm và nguồn hiệu lực; metadata shadow tách khỏi giá khách |
| `lockQuoteForBooking` và `acceptQuote` | Bắt buộc đã có event exposure mới cho booking | Bỏ phụ thuộc thành công của telemetry; thiếu exposure thì censor khỏi train, không tự tạo event |
| `useReservation.ts` | Nhận quote là ghi exposed; đổi lựa chọn ghi rejected; confirm chờ exposure | Ghi khi khối giá thực sự hiển thị; đổi lựa chọn tạo supersession khi quote thay thế hiển thị; lỗi analytics không chặn checkout |
| `booking_details.applied_price` và các query/tính tiền SQL | Dùng giá đêm × số đêm trong lịch sử, thanh toán và lifecycle | Bổ sung snapshot tổng + bảng từng đêm; dùng tổng snapshot khi có, công thức cũ khi không có |
| View dữ liệu cũ | Có nhiều nhãn payment/stay và proxy exposure | Tạo read model/exporter v1 riêng cho nhãn **chấp nhận báo giá**, không đổi nghĩa lịch sử |
| `pricing_settings`/guardrail shadow cũ | Có base price và multiplier bounds; chưa có chi phí biến đổi/sàn/trần tiền từng loại phòng/đêm | Cấu hình nghiệp vụ có phiên bản riêng; không coi multiplier guardrail cũ là chi phí đã biết |

Đặc biệt: tổng trung bình làm tròn 2 chữ số nhân 7 đêm có thể khác tổng từng đêm. `nightly_price` cũ sẽ là giá trung bình **chỉ để tương thích hiển thị**; mọi phép thu tiền/đối soát dùng tổng snapshot. Kiểm thử phải phát hiện mọi đường còn nhân lại trung bình, kể cả payment, check-out, lịch sử và outbox.

## 3. Schema mới dự kiến

Migration mới `019_ai_v1_learning_pipeline.sql` (kiểm tra lại số chưa bị dùng ngay trước tạo).

| Bảng/thay đổi | Nội dung và ràng buộc |
|---|---|
| `ai_v1_policy_versions` | Phiên bản bất biến, actor/phê duyệt, nguồn `demo_business_assumption` hoặc cấu hình thực; quy tắc làm tròn và hiệu lực |
| `ai_v1_policy_rules` | Loại phòng, khoảng hiệu lực, giá chính sách hoặc base được tham chiếu; sàn/trần/chi phí theo đêm; không cho rules cùng độ ưu tiên chồng lấn; validation sàn ≤ giá ≤ trần và chi phí ≤ giá |
| `ai_v1_context_snapshots` | ID/hash, observed_at, registry/parser/extractor/runtime/contract version, provenance, facts có dẫn chứng, coverage/missing reasons; snapshot bất biến; JSON có giới hạn dung lượng |
| `ai_v1_quote_decisions` | Quote FK unique; decision ID, context FK (nullable khi lỗi dịch vụ), policy version + inputs, mode/source/reason, contract/model version, propensity=1, giá hiển thị, giá shadow/p tại hiển thị/đề xuất nullable; traffic origin do server xác định |
| `ai_v1_quote_nights` | Quote FK + night unique; policy/displayed/shadow price, floor/ceiling/cost, tồn phòng và inputs mỗi đêm; giá VND nguyên bội 1.000 sau half-up; đầy đủ các đêm, sum = quote.total_price |
| `booking_details` | Thêm `total_price_snapshot` nullable và `pricing_quote_id` nullable. Thêm `ai_v1_booking_nights` theo detail + night để bảo toàn từng đêm; không cập nhật các booking cũ |
| `ai_v1_exposures` | Quote unique, server_received_at, hành trình ràng buộc server, giá hiển thị khớp snapshot, policy inputs/version, propensity=1, eligibility/traffic reasons; idempotent |
| `ai_v1_quote_supersessions` | Old/new quote FK, cùng hành trình đã xác thực, thời điểm; không tự là negative; không nhận liên kết quote khác hành trình |
| `ai_v1_quote_rejections` | Chỉ hành động từ chối rõ ràng, có exposure; server time và reason `explicit_reject`; đổi lựa chọn/đóng trang không tạo bản ghi |
| `ai_v1_admin_audit` | Actor, refresh/export, scope, result/hash, timestamp; append-only, không PII/secret |

Quote + decision + nights được ghi cùng transaction. Dùng deferred consistency constraint/trigger kiểm tổng, ngày, count, policy price và bất biến snapshot ở commit; không chấp nhận quote mới thiếu core. Bảng snapshot không cho UPDATE/DELETE nghiệp vụ. Booking attachment vẫn một chiều qua cơ chế cũ.

Chi tiết tổng tiền: thêm helper SQL lấy `COALESCE(total_price_snapshot, applied_price * nights)` theo detail; cập nhật các hàm lifecycle/thanh toán bằng migration **mới** và các query Nest dùng helper. Quyền/trigger audit tiền và transaction hiện có giữ nguyên; tạo tests cho cả booking legacy và snapshot. Không dùng average để quyết định tiền, refund cap, deposit hay checkout.

## 4. Luồng API và trạng thái

### Quote

1. Server đọc policy version, lịch và tồn phòng cho tất cả các đêm trong một snapshot nhất quán; policy config thiếu/không hợp lệ hoặc không có phòng thì từ chối phát hành quote.
2. Tạo nightly policy bằng decimal hoặc số nguyên VND; half-up 1.000 VND mỗi phòng/đêm. Hệ số 1,00 chính là policy đã làm tròn. Tổng = sum từng đêm.
3. Gọi FastAPI stay-decision qua mạng nội bộ, timeout cứng 750 ms. Không truyền URL từ browser, không chờ Ollama. Coverage/Qwen/conversion chưa đạt thì response có readiness + policy/no p. Lỗi/timeout cũng lưu reason tại backend; dữ liệu core vẫn do backend quyết định.
4. Ghi quote/nights/decision bất biến và trả API tương thích: các trường cũ cùng `decision_id`, `context_snapshot_id`, `pricing_mode`, `effective_source`, `fallback_reason`, `nightly_breakdown`. Trường cũ `pricing_source='base'` cho policy; `ai_enabled` thể hiện giá thực sự dùng AI, không phải cờ yêu cầu. Shadow có endpoint admin riêng, không lộ p/giá đề xuất cho khách.
5. Endpoint một đêm giữ lớp chuyển đổi; không đổi luồng theo giờ hoặc tự tạo conversion cho giỏ nhiều phòng. Mỗi phòng trong giỏ có quote riêng như hiện có.

### Exposure và hành trình

- Server cấp token hành trình opaque/HMAC ký, cookie cùng site hoặc cơ chế tương đương; không coi UUID tự khai từ browser là bằng chứng sở hữu. Client không tự quyết traffic origin. Bot/crawler nhận diện được, health/internal, seed/test/replay bị loại với lý do; không tuyên bố nhận diện được mọi bot.
- Ghi exposure khi khối tổng giá và thông tin kỳ ở thực sự nằm trong viewport, trang visible (IntersectionObserver), idempotent. Không ghi từ prefetch/server render/khởi tạo hook hoặc tự sinh khi booking thành công.
- Giá và policy payload exposure được nối từ quote trên server, không tin giá client gửi. Quote cũ/khác hành trình không được ghép chéo.
- Khi quote mới đã hiển thị, nối supersession cùng hành trình; đổi lựa chọn trước khi có quote mới không phải explicit rejection. Late analytics sau accept chỉ phục vụ audit và không được dùng để chứng minh exposure trước quyết định nếu không có bằng chứng thời gian phù hợp.
- Analytics hỏng không chặn checkout. Quote vẫn phải hợp lệ/tồn phòng đủ và các bảo vệ booking còn nguyên; thiếu xác nhận exposure loại khỏi train/readiness, không tính positive hợp lệ.

### Booking/outcome

Trong transaction hiện có: lock quote, kiểm đầu vào/TTL/từ chối rõ ràng/tồn phòng → tạo booking/details/night snapshots → accept quote + outbox → commit. Response sau commit lỗi thì retry theo idempotency trả booking cũ với cùng tổng.

Positive = backend tạo booking thành công từ quote. Payment/cancel/no-show/completed là kết quả riêng, không ghi đè acceptance. Negative = explicit reject hoặc quote hết hạn chưa accept sau 24 giờ đối soát. Chỉ train nếu có exposure hợp lệ trước outcome và context/contract đáp ứng; chưa đủ thì pending/censored. Cùng hành trình có nhiều quote vẫn giữ quan hệ supersession để lọc/phân tích, không kết luận nhạy cảm giá.

## 5. Exporter, readiness và quản trị

- CLI refresh/export bắt buộc có actor được ủy quyền, scope cho phép và audit; không nhận URL tùy ý. Refresh chỉ registry đã duyệt, request ledger/rate limit riêng, chặn nguồn ngay khi cần. UI read-only dùng JWT + admin guard hiện có.
- Exporter dùng danh sách trường cho phép, HMAC journey bằng khóa riêng không xuất theo dataset. Bỏ tên/email/điện thoại/IP; identifiers cần nối cũng giả danh; không xuất cookies/tokens/raw request headers. Có manifest/hash/version/cutoff, missing masks/coverage, negative_reason và supersession.
- Tách real/demo operator/seed/test_fixture/replay. Demo booking chứng minh luồng phần mềm, không đủ điều kiện chứng minh conversion đạt gate.
- Readiness giữ nguyên 500 quan sát/28 ngày, lớp/partition/nhóm tối thiểu, time split/grouping, embargo, domain/variation, baseline+CI/ECE/giá và shadow-only. Không artifact phù hợp thì không fit/xuất p giả.
- Admin xem nguồn đang tắt/chặn/thiếu, coverage/staleness, Qwen gate/runtime, conversion readiness, reason fallback và lineage. API admin mutation chỉ làm nếu còn thời gian; CLI đầy đủ audit là bắt buộc.

## 6. Cấu hình nghiệp vụ demo cần quyết định rõ

Code hiện có chưa cung cấp chi phí biến đổi thật và giới hạn tiền theo đêm. **Không suy ra các số này từ Qwen hoặc dữ liệu đối thủ.**

Đề xuất để hoàn tất demo DB tách biệt: một policy version ghi rõ **`demo_business_assumption`**, policy mỗi đêm bằng `room_types.base_price`, floor=80%, ceiling=130%, variable_cost=50% base, half-up 1.000 VND; áp dụng đủ 8 loại phòng, version/hiệu lực cố định. Đây là **giả định cấu hình nghiệp vụ để demo**, không phải số liệu thị trường hoặc nhãn conversion, không được đem triển khai vận hành thật. Các booking/thử nghiệm của demo luôn bị loại khỏi training thật. Đêm chưa có seasonal override dùng base policy rõ ràng; khả năng nightly snapshot được kiểm bằng fixture và rule override demo có nhãn, không bịa biến động thị trường.

Nếu người dùng không duyệt giả định này, cần cung cấp sàn/trần/chi phí/policy hợp lệ trước khi bật phát hành quote AI v1; vẫn có thể làm exporter/readiness/tests độc lập. Không điền cost=0 cho qua contract. Đây là đề xuất mới cần được duyệt, chưa tự áp dụng.

## 7. Migration, rollback và kiểm thử

- Trước áp dụng: lưu hash code/migration cũ, schema-only dump, backup demo và restore kiểm thử; kiểm tra không nhắm DB cũ. Migration có transaction, xác thực schema dự kiến; sai trạng thái thì dừng, không tự chữa migration lịch sử.
- Sau áp dụng: đối chiếu bảng/booking cũ không thay giá; validation snapshot/constraint, legacy query fallback và quyền admin. Rollback ứng dụng chỉ dùng bản tương thích schema mới; không hạ code về bản tính tiền trung bình với booking nightly còn tồn tại. Nếu cần rollback toàn demo, phục hồi backup sang DB demo mới và chuyển cấu hình, giữ DB lỗi làm bằng chứng; không DROP dữ liệu tại chỗ.
- Test trên ứng dụng thật Next → Nest → PostgreSQL → FastAPI: đủ 8 loại phòng, 1/2/7/30 đêm, month/year/horizon, giá policy thay sau phát hành vẫn không đổi quote, nguồn fallback đúng, exposure fail không chặn booking nhưng censor train, supersession không thành reject, TTL/hết phòng/cạnh tranh/retry sau commit, payment/deposit/refund/check-out/historical totals, các trạng thái outcome và export không PII, denied admin/URL input.
- Optimizer fixture riêng kiểm candidate101/làm tròn/sàn-trần/domain/sum/tie/1,00 ngoài miền không p. Không nạp fixture vào registry vận hành.
- p95 và refresh dưới tải, restart/job recovery/backup/restore triển khai ở M4–M5; chưa đạt thì báo, không hạ gate. M6 vẫn cần duyệt khóa riêng.

## Phạm vi xin duyệt

1. Thiết kế schema/API/booking/telemetry/rollback và tests ở trên trước khi bắt đầu M3.
2. Chọn dùng policy **giả định nghiệp vụ demo** ở mục 6, hoặc cung cấp cấu hình nghiệp vụ khác. Duyệt M3 không phải duyệt gate Qwen, kích hoạt giá AI thật, khóa release hoặc sử dụng dữ liệu demo để đạt gate conversion.
