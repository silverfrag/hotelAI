# Lộ trình AI-first cho Hotel AI

## 1. Định hướng sản phẩm

AI pricing là lõi của sản phẩm. Nghiệp vụ booking, vận hành phòng, thanh toán và
thông báo được phát triển song song vì chúng vừa bảo vệ quyết định giá, vừa tạo
ra dữ liệu phản hồi đáng tin cậy cho các vòng huấn luyện tiếp theo.

Không đánh giá AI chỉ bằng việc API trả được một multiplier. Hệ thống phải trả
lời được bốn câu hỏi:

1. Model nào đã tạo ra mức giá này?
2. Model đã nhìn thấy những feature nào tại thời điểm báo giá?
3. Khách đã chấp nhận, bỏ qua, hủy hay hoàn tất booking đó?
4. Quyết định giá tác động thế nào đến conversion, occupancy và doanh thu?

## 2. Hai luồng phát triển song song

### Luồng A — AI và dữ liệu

- Một feature contract dùng cùng định nghĩa giữa training và serving.
- Training tái lập được bằng seed, version dữ liệu, feature order và metadata.
- Đánh giá theo thời gian, không chỉ random split; so sánh với baseline đơn giản.
- Lưu đầy đủ quote exposure, model version, feature snapshot và kết quả chuyển đổi.
- Tiến dần từ dự đoán multiplier lịch sử sang hai tầng:
  - dự đoán nhu cầu/xác suất chuyển đổi;
  - bộ tối ưu giá có guardrail kinh doanh.
- Champion/challenger và shadow evaluation trước khi thay model đang phục vụ.
- Theo dõi drift, sai số, conversion, occupancy, RevPAR và tỷ lệ nhân viên override.

### Luồng B — Nghiệp vụ tạo dữ liệu đúng

- Quote có ID, thời hạn và giá được bảo đảm khi khách xác nhận.
- Booking idempotent, có số khách và kiểm tra capacity.
- Pending/expiry hoặc quy trình bảo đảm booking khi chưa thanh toán trực tuyến.
- Housekeeping, đổi phòng, công nợ, hủy/no-show và audit đầy đủ.
- Email verification, khôi phục tài khoản và thông báo giao dịch.

Hai luồng gặp nhau tại `pricing_quote`: đây vừa là hợp đồng giá với khách, vừa là
đơn vị dữ liệu đầu vào cho huấn luyện và đánh giá online.

## 3. Các mốc triển khai

### M0 — Feature contract và khả năng tái lập

- Sửa mọi train-serving skew hiện có.
- Xuất model metadata gồm model version, feature order/semantics, dataset fingerprint,
  thời điểm train, tham số và metric.
- Inference từ chối artifact không tương thích.
- Có test cho feature engineering và model contract.

### M1 — Quote lineage và feedback loop

- Tạo `pricing_quotes` với `quote_id`, input snapshot, inventory/occupancy snapshot,
  model version, multiplier, giá, currency, `expires_at` và trạng thái.
- Booking nhận `quote_id` và `Idempotency-Key`, xác nhận đúng giá còn hiệu lực.
- Gắn quote với booking; ghi nhận expired/rejected/accepted/canceled/completed.
- Không dùng dữ liệu chỉ gồm booking thành công để đánh giá conversion.

### M2 — Baseline đáng tin và feature thực tế

- Time-based split/backtest và baseline theo mùa/ngày trong tuần.
- Bổ sung stay length, ngày trong tuần, mùa/lễ, lead time, room type, occupancy,
  pickup pace, cancellation/no-show và lịch sử giá.
- Loại feature không có ý nghĩa nghiệp vụ hoặc có thể bị khách thao túng trực tiếp.
- Đặt acceptance gate dựa trên baseline thực nghiệm, không chọn ngưỡng tùy ý.

### M3 — Vận hành khách sạn và chất lượng nhãn

- Hoàn thiện pending/expiry, guest count/capacity, housekeeping, room reassign,
  công nợ, cancel/no-show và notification.
- Chuẩn hóa event để tạo training dataset theo thời điểm, tránh leakage.
- Thêm retention, anonymization và data quality checks.

### M4 — Thử nghiệm AI có kiểm soát

- Chạy champion/challenger; model mới dự đoán song song nhưng chưa tự thay model chính.
- Guardrail cho giá tối thiểu/tối đa, mức thay đổi và quyền override.
- Dashboard so sánh model theo conversion, occupancy, RevPAR và phân khúc.
- Chỉ promote model khi vượt gate và có thể rollback artifact ngay lập tức.

### M5 — Product UI và production readiness

- Nhánh UI riêng tiêu thụ API contract đã ổn định, không trộn redesign vào logic AI.
- Hoàn thiện HTTPS, backup/restore drill, migration versioning, monitoring/alerting,
  release artifact và rollback.
- Public production chỉ sau khi cả AI gate, nghiệp vụ và vận hành đều đạt tiêu chí.

## 4. Thứ tự công việc hiện tại

1. `AI-001`: thống nhất feature weekend, thêm metadata/evaluation và test. **Đã hoàn thành code.**
2. `BOOKING-001`: idempotency, guest count và capacity enforcement. **Đã hoàn thành backend.**
3. `AI-002`: pricing quote lineage, price guarantee và conversion outcome. **Đã hoàn thành end-to-end; UI reference đã ghi exposed/rejected và booking dùng quote ID/idempotency key ổn định.**
4. `AI-003a`: chronological holdout và baseline mùa/ngày. **Đã hoàn thành; model
   hiện vượt MAE baseline 7,35% nhưng R² còn âm, chưa đạt chất lượng product.**
5. `AI-003b`: feature set thế hệ hai và dataset quote/conversion. **Đã hoàn
   thành: v2 giảm ADR MAE khoảng 17,32% so với v1; quote event ledger,
   censor-aware training view và instrumentation UI đã có.**
6. `AI-004`: conversion challenger và shadow evaluation. **Đã hoàn thành phần
   triển khai end-to-end:** export không PII, data-quality/readiness gate,
   chronological training, artifact compatibility, optional inference, attempt /
   decision ledger, lineage, coverage/error readiness và control plane có audit.
   **Promotion đang pause đúng thiết kế** vì dữ liệu thật chưa đạt 2.000 mature
   exposures, 200 positive, 200 negative và 28 ngày; chưa sinh artifact thật.
7. `AI-005`: shadow price optimizer và guardrail. **Đã hoàn thành khung kỹ thuật
   shadow-only:** candidate scoring, absolute/relative guardrail, fail-open,
   policy versioning, pause/rollback và smoke thành công/lỗi. Chưa được bật live;
   cần artifact AI-004 vượt gate, tối thiểu 14 ngày shadow với coverage ≥99%, lỗi
   <1%, không mismatch và bằng chứng causal từ thí nghiệm giá có kiểm soát.
8. `OPS-001A`: housekeeping và room reassign. **Đã hoàn thành end-to-end:**
   checkout chuyển phòng sang Dirty, check-in yêu cầu Ready, queue/transition có
   optimistic version và idempotency, đổi phòng bảo toàn giá cùng AI lineage,
   ledger append-only, outbox, contract frontend và smoke race/inventory đều có.
9. `OPS-001B`: pending/expiry, chính sách đặt cọc/công nợ, no-show đầy đủ và
   notification. **Đã triển khai và kiểm thử backend/SQL:** Pending giữ tồn có TTL,
   deposit policy snapshot, credit checkout, NoShow/Expired và notification in-app.
   71 kiểm tra HTTP workflow pass; không còn đánh dấu NoShow là completed stay.
10. `OPS-002A`: migration ledger, restricted DB role và isolated restore drill.
    **Đã có code và kiểm thử local**, chưa nâng cấp DB đang chạy hoặc chứng nhận
    cấu hình production. Chi tiết và release blockers: `execution-checkpoint.md`.

Frontend hiện tại được đóng băng ở vai trò UI chức năng/reference trong các mốc
trên. Redesign có thể thực hiện ở nhánh riêng sau khi API quote/booking ổn định.
