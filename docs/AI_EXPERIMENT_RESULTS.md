# Thực nghiệm HotelAI academic-v1

Ngày chạy: 2026-10-26. Nguồn: CSV Portugal 2015–2017, SHA256 trong `app/models/academic_v1/report.json`. Lệnh tại AI service: `.venv/Scripts/python.exe -m app.training.academic_training`. Không thay artifact legacy. JSON report/holdout/manifest và bundle joblib được lưu cùng thư mục `academic_v1`.

## Thiết kế

Hai property categories cùng được dùng, hotel/room code là feature; không gán nhãn resort Việt Nam. Whitelist và rà soát **tất cả 32 cột raw** tại `app/training/academic_contract.py`. ADR chỉ là nhãn trong cohort positive ADR / Check-Out / non-canceled; đây là sai lệch chọn mẫu conditional-on-completion, không phải mọi mức giá được chào. `is_canceled` là nhãn phân loại, bao gồm No-Show. Không có target/outcome/assigned room/requests/deposit/history/occupancy/velocity trong X.

Creation proxy = arrival − lead_time. Train creation < 2016-07-01; validation từ 2016-07-01 đến trước 2017-01-01; test từ 2017-01-01. Outcome availability = status date + 1 ngày; ADR dùng max(status date, checkout) + 1 ngày. Chỉ giữ nhãn mature trước cutoff tương ứng; daily precision không giả định có timestamps giờ. Evaluation as-of 2017-09-16. Preprocessing chỉ fit train, không refit sau chọn model. Selection theo validation MAE / log loss, cố định trước test.

Train/validation/test ADR: **24327 / 9140 / 16294**; purged unmatured train/validation **7113 / 4738**. Cancellation: **34513 / 14209 / 22893**, purged **8585 / 6220**. Test không có nhãn chưa mature tại evaluation-as-of. Bỏ 31994 dòng raw trùng toàn bộ để làm phân tích unique-record; thiếu booking IDs nên có thể gộp booking nhóm hợp lệ. Không tuyên bố đó là lỗi dữ liệu. Mọi metric bên dưới phụ thuộc chính sách này.

## ADR — EUR/đêm, test độc lập

| Candidate | MAE | RMSE | R² |
|---|---:|---:|---:|
| Rule calendar: train median +10% weekend stay +10% arrival Jan 1/Dec 25 | 47.452750 | 64.424811 | −0.335339 |
| Train median theo hotel/room/month, room/global fallbacks | 32.736602 | 44.700306 | 0.357155 |
| Random Forest | 26.737921 | 37.833105 | 0.539500 |
| HistGradientBoosting **selected** | 27.072904 | 37.190104 | 0.555020 |

Boosting thắng validation MAE (22.781095 vs RF 24.836683); trên test RF có MAE thấp hơn. **Giữ boosting theo selection đã chốt**, không chọn lại bằng test. MAE model selected cải thiện 5.663698 EUR, khoảng 17.30% so seasonal median trong thí nghiệm này; đây không phải tăng doanh thu hay chất lượng thị trường VN. Baseline holiday chỉ dùng hai ngày cố định để làm đối chứng script, không đại diện đầy đủ lịch lễ Portugal và không đo holiday uplift nhân quả.

## Cancellation — is_canceled includes No-Show

| Candidate | Precision @.5 | Recall @.5 | F1 @.5 | ROC-AUC | PR-AUC | Brier | Log loss |
|---|---:|---:|---:|---:|---:|---:|---:|
| Constant train prevalence | 0 | 0 | 0 | .500000 | .279037 | .201180 | .592052 |
| Logistic Regression **selected** | .464632 | .314652 | .375210 | .690028 | .425338 | .190317 | .562413 |
| HistGradientBoosting | .438292 | .379148 | .406580 | .703072 | .417323 | .213045 | .638031 |

LR được chọn bằng validation log loss (.529968 vs boosting .532956). Confusion matrix selected, hàng actual 0/1, cột predicted 0/1: `[[14189, 2316], [4378, 2010]]`. Recall .31465 cho thấy bỏ sót nhiều booking hủy ở threshold .5. Boosting có AUC cao hơn nhưng **log loss/Brier thua baseline**, tự tin quá mức ở vùng p cao. LR cũng calibration kém ở các band p cao: bin .7–.8 mean p .742559, observed .499452, n=913. Không trình bày risk score như xác suất đã được calibration tốt trong mọi nhóm; không dùng để tự hủy/reject booking.

## Bằng chứng và giới hạn

`report.json` có config/seed/runtime/code+data hash, validation/test metrics của tất cả candidates, slices theo hotel/room/month/segment, calibration/confusion matrix và top 10 lỗi / 5 trường hợp tốt. `holdout.json` giữ toàn bộ unique-record test inputs/observed/predictions để UI đối chiếu. `manifest.json` hash các files, service kiểm tra trước load.

**Giới hạn chưa thể giải quyết bằng code:** CSV snapshot gần arrival không cung cấp feature values tại creation, vì vậy đây là retrospective proxy dùng creation-intended inputs với giả định chúng ổn định. Split/label-maturity checks ngăn nhìn trước outcome trong tập fit, nhưng không chứng minh mọi mutable feature là snapshot creation. Mốc creation suy ra và cohort arrival bị cắt cũng hạn chế kết luận. Đánh giá prospective cần booking event history thật. Các giới hạn phải hiện ở UI/API, không bị ẩn trong báo cáo.

Kiểm thử đã chạy: academic pipeline + persisted inference **9 passed**, gồm không đưa outcome vào X, purge nhãn từng cutoff, preprocessing train-only/unknown category, baselines, partitions rời nhau, persisted model khớp frozen holdout, reference replacement explanations, missing/unknown/out-of-range warnings, baseline fallback có nhãn và checksum rejection.

## Vấn đề cải tiến mở

- **AI-EXP-001:** Calibration drift/high-risk overconfidence; cần future validation windows hoặc calibration fit trên validation riêng; không tune lại trên test đã công bố. Boosting classification hiện là challenger không được chọn.
- **AI-EXP-002:** Snapshot creation không có, cần dữ liệu event history trước khi khẳng định hiệu quả prospective.
- **AI-EXP-003:** Thiếu booking IDs, unique-record policy có thể làm mất multiplicity booking nhóm. Cần sensitivity run rõ raw-vs-unique khi nghiên cứu mở rộng; không dùng metric unique để khẳng định population booking-level.
- **AI-EXP-004:** Mô hình ADR được fit cohort completed only, nên reference cho booking mới có selection bias; không suy ra giá tối ưu.
