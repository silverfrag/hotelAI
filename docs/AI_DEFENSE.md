# Kịch bản bảo vệ HotelAI

## Mở đầu — 30 giây

“Đây là hệ thống hỗ trợ phân tích booking. Hai bài toán là ước lượng ADR lịch sử và nguy cơ hủy/no-show. Dữ liệu công khai của hai hotel Portugal 2015–2017; giao diện Aurum là mô phỏng. Hệ thống chưa chứng minh giá tối ưu hay doanh thu tăng.”

## Luồng demo — 5 phút

1. Mở AI Experiment. Giới thiệu bảng baseline/ML cùng test. Chọn ADR, nhóm “Theo thứ tự nguồn”, một booking test chưa dùng để fit hay chọn model.
2. Bấm “Chạy inference thật”. UI gửi booking qua Next proxy → NestJS → FastAPI → pipeline đã lưu. Chỉ sau inference mới đối chiếu observed ADR; nhãn thật không được gửi làm feature.
3. Chỉ giá dự đoán, baseline và sai số tuyệt đối. Mở thông tin đầu vào/version. Giải thích biểu đồ là thay nhóm feature bằng booking tham chiếu trong train; chênh lệch không cộng thành tổng và không phải tác động nhân quả.
4. Chọn “Dự đoán gần nhãn nhất”, chạy lại; sau đó chọn “Sai số lớn nhất”, chạy lại. Trình bày cả thành công và thất bại, không coi ví dụ được chọn là đại diện toàn tập.
5. Chuyển bài toán cancellation; đối chiếu nhãn is_canceled. Thảo luận recall và calibration còn yếu. Không suy ra khách có chấp nhận mức giá khác hay không.
6. Mở Decision Lab, thay lead time, số đêm, loại khách sạn/phòng; kết quả cũ phải mất đi. Chạy lại, nhấn mạnh đây là kịch bản giả định chưa có nhãn thật để chấm sai số.
7. Để children trống hoặc đặt lead time 999: xem cảnh báo missing/imputation hoặc ngoài training domain. Thử năm ngoài 2015–2017: không coi việc API vẫn trả số là bằng chứng chuyển miền tốt.
8. Trình bày giới hạn: CSV không có lịch sử feature tại lúc tạo booking, creation suy từ arrival−lead_time; đây là retrospective proxy. ADR cohort completed-only có selection bias. Không có quote exposures, giá bị từ chối, inventory và lịch sử sửa booking để học tối ưu doanh thu.

“Booking mới” trong demo có nghĩa chưa dùng trong huấn luyện hoặc một input giả định. Không giới thiệu nó là booking khách hàng thật mới phát sinh tại Aurum.

## Thí nghiệm đối chứng bắt buộc

Script calendar = median train × (1 + 0.10 × indicator có đêm cuối tuần + 0.10 × holiday indicator). Holiday chỉ Jan 1/Dec 25, là quy tắc minh họa, không phải lịch lễ đầy đủ hay hiệu ứng học được. Đối chứng median hotel/room/month có fallback hotel/room/global. Tất cả được đo trên cùng 16.294 dòng ADR test.

| Phương pháp | MAE EUR | RMSE EUR | R² |
|---|---:|---:|---:|
| Calendar rule | 47.452750 | 64.424811 | −0.335339 |
| Seasonal/room median | 32.736602 | 44.700306 | 0.357155 |
| Random Forest | 26.737921 | 37.833105 | 0.539500 |
| Boosting selected | 27.072904 | 37.190104 | 0.555020 |

Boosting được chọn vì validation MAE tốt hơn; test MAE của RF tốt hơn. Không đổi selected theo test. Cải thiện MAE 17,30% so với seasonal median không phải tăng doanh thu 17,30%.

Ví dụ ADR source `booking-103967`: observed 114 EUR, selected khoảng 88,13 EUR. Ví dụ lỗi lớn `booking-111403`: observed 510 EUR, selected khoảng 90,57 EUR. Giá chính xác và mọi candidate nằm trong holdout/report; UI gọi lại pipeline thật. Ví dụ “gần nhất” lấy từ smallest_errors/selector thay vì hardcode câu chuyện thành công.

## Câu hỏi thường gặp

- Tại sao không dùng LLM? Hai bài toán có nhãn dạng bảng, mô hình được chọn bằng validation. LLM không phải tiêu chí để một hệ thống là học máy.
- Tại sao Logistic Regression? Validation log loss tốt hơn challenger. Test ROC-AUC khoảng 0,690; recall @0,5 khoảng 0,315 và calibration vùng nguy cơ cao còn yếu, nên chưa dùng cho quyết định tự động.
- Có rò rỉ dữ liệu không? Outcome không có trong feature whitelist; preprocessing fit train, purge nhãn chưa biết tại cutoff. Tuy nhiên source snapshot không chứng minh feature values đúng lúc creation, nên không tuyên bố prospective validation.
- Vì sao không dùng occupancy/booking velocity? Không có inventory/event history đáng tin cậy. Tự tạo các feature đó sẽ làm sai bằng chứng dữ liệu thật.
- Làm sao kiểm chứng? Chạy downloader checksum, training output riêng, reproduction verifier và HTTP integration theo AI_DEMO.md. Report chứa seed, config, source/code hash, runtime và model version.
