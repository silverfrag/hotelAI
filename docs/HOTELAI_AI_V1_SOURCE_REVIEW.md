# Nguồn dữ liệu AI v1 — rà soát ngày 2026-11-07

## Giá đối thủ: chưa đạt điều kiện collector

Đã dùng **8 request, 2/nguồn**, gồm robots và trang công khai. Không theo redirect, đăng nhập, giải CAPTCHA, thay danh tính, dùng proxy hay truy cập booking endpoint khi chưa xác lập điều kiện sử dụng. Chưa có báo giá cùng kỳ ở đủ thông tin để dùng làm feature.

| Nguồn | Quan sát | Kết luận hiện tại |
|---|---|---|
| Pullman | Robots/trang công khai HTTP 200 | Chưa có báo giá đủ trường và chưa hoàn tất rà soát điều khoản booking engine |
| InterContinental | Robots/trang công khai HTTP 200 | Có chuỗi captcha trong HTML nhưng không đủ bằng chứng kết luận access challenge; tạm dừng, chưa xác lập quyền và báo giá |
| HAIAN | Robots/trang công khai HTTP 200 | Cùng tình trạng tín hiệu captcha chưa được xác minh; tạm dừng, chưa xác lập quyền và báo giá |
| Monarque | Robots/trang công khai HTTP 200 | Trang giới thiệu không chứng minh báo giá cùng kỳ; điều khoản booking engine chưa được xác lập |

Bộ nhận diện ban đầu đã đánh dấu nhầm tín hiệu chuỗi captcha thành blocked. Đã sửa bộ kiểm tra, giữ dấu vết phân loại ban đầu trong evidence và kiểm thử rằng reCAPTCHA ở form liên hệ không đồng nghĩa chặn truy cập. Không fetch lại các nguồn đó để vượt tín hiệu chặn. Chưa quan sát được HTTP 403 trong đợt này.

Người dùng ban đầu chọn (b), sau đó xác nhận **“chưa có url công khai hoặc link tài liệu tạm chuyển qua a”**. Nhánh hiện tại là **(a)**: contract `stay-market-v1-no-competitors` tắt nhóm giá đối thủ, trạng thái “độ phủ giá đối thủ không đủ”. Không điền số trung tính, không nạp artifact yêu cầu nhóm bị tắt. Đây là xử lý thiếu nguồn đã được duyệt, không phải chứng minh collector giá hoạt động. Admin/báo cáo sẽ tích hợp trạng thái ở M3; chưa được phép khóa toàn release khi các mốc khác còn mở.

Bằng chứng: `artifacts/hotelai-ai-v1/20261029-092250/M1/` có ledger, robots, phản hồi/hash, quyết định nhánh và kết quả test.

## Corpus Qwen3: đang chuẩn bị, chưa đánh giá gate

Đã kiểm tra cả 5 tên miền người dùng duyệt. Ledger hiện có **100 request**: danang.gov.vn 89, danangfantasticity.com 3, startupdanang.vn 3, baodanang.vn 3, cttdt.danangportal.gov.vn 2. Redirect/robots/điều khoản đều tính ngân sách; không mở lại theo phiên chạy. Đã thu **80 văn bản thật** từ danang.gov.vn, có attribution/hash/thời điểm; chỉ dùng phạm vi đã kiểm tra, không chuyển nguồn còn vướng quyền vào corpus.

| Nguồn | Trạng thái sau rà soát |
|---|---|
| danang.gov.vn | Robots cho phép; chân trang nêu điều kiện dẫn nguồn khi sử dụng lại. Có thể chuẩn bị corpus trong phạm vi đã kiểm tra, kèm dẫn nguồn và kiểm tra robots cho từng đường dẫn |
| startupdanang.vn | Robots cho phép trang công khai; ghi nhận bảo lưu bản quyền, quyền sử dụng cho corpus chưa làm rõ |
| baodanang.vn | Chân trang yêu cầu đồng ý bằng văn bản khi phát hành lại; chưa dùng vào corpus, chờ quyền phù hợp |
| danangfantasticity.com | Robots trả 404; chưa kết luận bị chặn, chưa làm rõ điều kiện thu tự động |
| cttdt.danangportal.gov.vn | Trang gốc trả 302; chưa theo redirect. Không dùng alias để tăng ngân sách hoặc đếm trùng văn bản |

Người dùng **đã duyệt tối đa 100 request riêng danang.gov.vn**, tổng corpus vẫn tối đa 200, cách nhau ít nhất 5 giây; các nguồn khác giữ 50. Cấu hình/decision lưu cùng ledger. Có 30 dev nhãn nháp hoàn chỉnh, 30 test nháp và 20 dự phòng; dự phòng không tính vào bộ tham chiếu 60. Đã gửi gói sớm 30 test +10 dev, **chờ người dùng duyệt**, chưa có gold được phê duyệt, chưa chạy test chính thức. Bộ test đề xuất chỉ có một cụm dương (ba bài cùng một hội nghị) và chưa có ưu đãi phòng dương; phải nêu bằng chứng yếu/giới hạn phạm vi, không trình bày như chất lượng tổng quát.

Bằng chứng: `artifacts/hotelai-ai-v1/20261029-092250/M2/` có ledger, robots, ghi chú điều kiện sử dụng và trạng thái từng nguồn. Đây là ghi nhận các trang đã kiểm tra, không khẳng định mọi đường dẫn hoặc mọi cách sử dụng đều được cho phép.

## Hợp đồng coverage đã có mã kiểm tra độc lập

`app/core/stay_market_contract.py` kiểm tra dữ liệu backend bao phủ đầy đủ từng đêm, loại trạng thái tồn phòng không hợp lệ, weather ≥80%, sự kiện có phạm vi đánh giá 100%, hai báo giá đối thủ đều bao phủ toàn kỳ. Có kiểm tra độ cũ, replay, missing mask/null, gate LLM và phiên bản riêng khi tắt nhóm theo quyết định được duyệt.

Module hiện chỉ đánh giá, chưa được nối vào quote/booking. Không cấp xác suất giả; V1 vẫn dùng policy, model đủ điều kiện mới có thể vào shadow. Việc nối backend/booking/migration đợi thiết kế M3 được duyệt.
