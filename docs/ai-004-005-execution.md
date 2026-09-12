# AI-004 → AI-005: kế hoạch thực thi và promotion gate

Tài liệu này là checkpoint vận hành cho nhánh AI-first. Mục tiêu là cho phép xây
pipeline nhanh và song song, nhưng không đánh đồng việc code chạy được với việc
model đã có đủ bằng chứng để tác động giá thật.

## Trạng thái đầu vào

- Pricing champion: `random_forest_v2`, feature contract `2.0.0`.
- Quote đã có lineage, inventory snapshot, thời hạn bảo đảm giá và outcome ledger.
- Dataset `pricing_quote_training_dataset_v1` giữ label của quote còn mở ở `NULL`.
- UI hiện tại chỉ là giao diện chức năng/reference; instrumentation không được làm
  thay đổi thiết kế.

## Trạng thái triển khai ngày 2026-09-05

Phần kỹ thuật end-to-end của AI-004 và khung an toàn AI-005 đã hoàn tất. Trạng
thái vận hành vẫn là **shadow paused**; giá trả cho khách luôn là giá champion.

- Frontend reference đã gửi `quote.exposed.v1` đúng lúc quote được render, chỉ
  gửi `quote.rejected.v1` sau một exposure đã xác nhận, và chuyển `quote_id` cùng
  idempotency key ổn định sang booking. Không có thay đổi thiết kế UI.
- Migration `012` cung cấp dataset censor-aware với gate tồn kho chặt chẽ;
  migration `013` thêm policy versioned, attempt/decision ledger append-only,
  readiness view, audit, pause và rollback.
- Snapshot feature/price/lineage của quote được DB khóa bất biến sau khi sinh;
  export nhiều trang dùng một `REPEATABLE READ` snapshot để dataset/hash tái lập.
- Pipeline export → readiness → chronological training đã có. Với dataset dev
  hiện có, pipeline trả `insufficient_data` và không sinh/ghi đè artifact; đây là
  kết quả đúng theo gate, không phải lỗi triển khai.
- FastAPI có conversion inference và shadow optimizer. Core API gọi fail-open,
  lưu cả lần thử thành công/thất bại, kiểm tra lineage và để PostgreSQL áp dụng
  guardrail cuối cùng.
- Readiness chỉ tính telemetry đúng cửa sổ policy theo `quote.created_at`; attempt
  ngoài cửa sổ được đếm riêng và chặn trạng thái review-ready.
- Control plane chỉ có endpoint quản trị; chưa thêm màn hình admin mới vì UI hiện
  tại được giữ ở vai trò reference và nhánh thiết kế có thể làm riêng.
- Không có route promote và không có cơ chế tự bật shadow/live optimization.

Các endpoint đã ổn định:

- AI nội bộ: `GET /api/v1/conversion-model-info`,
  `POST /api/v1/predict-conversion`,
  `POST /api/v1/optimize-price-shadow`.
- Admin Core: `GET/PATCH /api/v1/core/admin/pricing/shadow/settings`,
  `POST /api/v1/core/admin/pricing/shadow/pause`,
  `POST /api/v1/core/admin/pricing/shadow/rollback`,
  `GET /api/v1/core/admin/pricing/shadow/readiness` và
  `GET /api/v1/core/admin/pricing/shadow/audits`.

Checkpoint vận hành tiếp theo là thu đủ dữ liệu thật, chạy pipeline và chỉ cấu
hình challenger vào shadow sau khi artifact vượt model gate. AI-005 chỉ được cân
nhắc live sau shadow gate và một thí nghiệm giá có cơ sở nhân quả.

## AI-004 — conversion/demand challenger

### Luồng dữ liệu bắt buộc

1. UI tạo quote qua `POST /api/v1/core/pricing/quote`.
2. Chỉ khi báo giá thật sự xuất hiện trên màn hình, UI ghi
   `quote.exposed.v1` qua `POST /api/v1/core/pricing/quotes/:quoteId/events` với
   `session_id`, `search_id` và `Idempotency-Key` ổn định.
3. UI chỉ ghi `quote.rejected.v1` khi người dùng chủ động thay hoặc bỏ quote.
   Unmount, lỗi mạng và đóng tab không được tự suy diễn thành rejected; quote hết
   hạn sẽ tự có nhãn âm khi label trưởng thành.
4. Booking phải gửi đúng `quote_id` và một `Idempotency-Key` ổn định.
5. Training chỉ nhận observation thỏa toàn bộ điều kiện:
   `exposure_confirmed = true`, `acceptance_label IS NOT NULL`,
   `inventory_snapshot_consistent = true` và
   `has_disposition_conflict = false`.

### Data-readiness gate mặc định

Các ngưỡng là cấu hình khởi đầu, phải được báo cáo theo toàn bộ tập và theo room
type; không được âm thầm hạ gate để sinh artifact.

- Ít nhất 2.000 confirmed/mature exposures.
- Ít nhất 200 positive và 200 negative labels.
- Ít nhất 28 ngày exposure riêng biệt và chronological holdout có cả hai lớp.
- Không có disposition conflict trong tập eligible.
- Không có inventory snapshot thiếu hoặc sai trong tập eligible.
- Generated proxy, quote còn mở và dòng trùng được báo cáo riêng, không dùng làm
  negative label.

Khi chưa đạt, pipeline phải sinh readiness report và kết thúc ở trạng thái
`insufficient_data`; không ghi đè artifact challenger đang dùng.

### Model gate

- Split theo `exposure_at`, tuyệt đối không random split xuyên thời gian.
- So sánh với constant-rate baseline chỉ được fit từ training partition.
- Báo cáo tối thiểu: log loss, Brier score, ROC-AUC, PR-AUC, calibration và metric
  theo room type/price band.
- Challenger chỉ đủ điều kiện shadow khi Brier và log loss đều tốt hơn baseline,
  holdout chứa cả hai lớp và metadata/artifact tương thích feature contract.
- `ai_multiplier`/price ratio có thể là feature dự đoán; dữ liệu quan sát không
  được diễn giải thành tác động nhân quả của thay đổi giá.

### Shadow gate

- Shadow inference luôn fail-open và không được thay giá champion trả cho khách.
- Mọi prediction phải liên kết với immutable `quote_id`, model version, training
  run, feature contract và config version.
- Không có endpoint hoặc job tự động promote.
- Trước khi cân nhắc AI-005: tối thiểu 14 ngày shadow, coverage từ 99%, lỗi dưới
  1%, không có lineage mismatch và metric mature vẫn vượt baseline.

## AI-005 — optimizer có guardrail

Có thể xây simulator, candidate scorer và guardrail song song với AI-004. Tuy
nhiên optimizer không được bật live chỉ từ dữ liệu quan sát. Cần một thí nghiệm
giá có kiểm soát hoặc nguồn variation hợp lệ để ước lượng elasticity.

Guardrail tối thiểu:

- multiplier tuyệt đối nằm trong min/max đã version hóa;
- mức thay đổi so với champion bị giới hạn;
- không tạo giá âm, NaN hoặc thấp hơn sàn nghiệp vụ;
- cấu hình và override có audit;
- một thao tác rollback đưa serving về champion trước đó;
- guardrail violation chỉ ghi shadow decision, không tác động quote đang phục vụ.

## Điều kiện dừng/pause

Pause promotion, nhưng vẫn tiếp tục thu thập dữ liệu, khi xảy ra một trong các
điều kiện: thiếu sample, label chưa trưởng thành, schema/feature mismatch, data
quality fail, shadow error vượt gate, metric không hơn baseline hoặc chưa có bằng
chứng causal cho optimizer. Giới hạn công cụ/usage là checkpoint kỹ thuật; trạng
thái phải được lưu trong roadmap và không được đánh dấu hoàn thành giả.

Trạng thái checkpoint hiện tại: **pause promotion do thiếu sample thật**. Việc
thu thập outcome vẫn tiếp tục; champion pricing và toàn bộ nghiệp vụ không bị
tắt. Shadow phải được bật bằng thao tác quản trị có reason/version sau khi có
artifact hợp lệ, và có thể pause tức thì mà không ảnh hưởng champion.
