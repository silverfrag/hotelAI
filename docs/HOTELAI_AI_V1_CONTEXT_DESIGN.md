# Thiết kế phần trích xuất M2 — đã được duyệt

Người dùng duyệt trong chat ngày 2026-11-07: “Duyệt thiết kế M2, làm trên dev rồi đóng băng lại”. M0 đã đóng băng adapter ban đầu; lần này bổ sung định dạng ngày có dấu `-` và loại thông tin theo thiết kế. Chưa chấm test chính thức.

## Điều chỉnh đề nghị trên dev

- Qwen3 chọn `fact_type` trong `event`, `travel_disruption`, `hotel_offer`, và các span chứa tên, địa điểm, khoảng thời gian. Không nhận giá do LLM tự tính, hệ số tác động hoặc suy đoán nguyên nhân/doanh thu.
- Code chấp nhận ngày có đủ ngày–tháng–năm: `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, kể cả ngày/tháng một chữ số. Dẫn chứng vẫn phải được sao chép đúng từ nguồn; ngày chuẩn hóa thành ISO được lưu riêng. Chưa ghép năm từ ngày đăng, năm hiện tại hoặc phần không xác định. Chỗ thiếu/mơ hồ bỏ và ghi lý do.
- Địa lý chỉ nhận khi có bằng chứng địa điểm Đà Nẵng rõ ràng. Alias cần bảng ánh xạ có phiên bản và bằng chứng; chưa tự suy rộng toàn bộ địa danh trên cổng thông tin thành địa điểm áp dụng cho khách sạn.
- Giữ đầu ra JSON schema nghiêm, cùng nguồn/span, so dẫn chứng sau chuẩn hóa khoảng trắng, một thông tin một lần. Sự kiện, gián đoạn và ưu đãi giữ loại riêng; không cộng gián đoạn/ưu đãi vào `event_count`.
- Nhãn âm gồm thông tin không có hiệu lực tuyệt đối xác định được, nội dung hành chính nội bộ không thuộc phạm vi du lịch/khách sạn, lịch lặp thiếu năm áp dụng, tin chỉ có ngày đăng, và văn bản không có thông tin đủ bốn điều kiện trong plan. Trường hợp giáp ranh ghi chưa chắc để người dùng duyệt.
- Tin lễ hội có thể có nhiều thông tin riêng (sự kiện chính, chương trình thành phần, hạn chế giao thông) nếu mỗi thông tin có đủ loại/địa lý/thời gian/dẫn chứng. Nhãn tham chiếu phải duyệt rõ, không tạo nhãn từ chính Qwen3.

## Cách duyệt và kiểm chứng

- Chỉ dùng tập dev để sửa prompt/schema/chuẩn hóa. Chưa dùng test chỉnh ngưỡng/prompt; test vẫn cần người dùng duyệt toàn bộ nhãn trước lần chấm đầu.
- Giữ nguyên model/digest/quantization, context 8192, output tối đa 700, một luồng/worker, keep_alive=0; precision ≥90%, recall ≥70% và mọi điều kiện còn lại giữ nguyên.
- Sau thay đổi: test transport/grounding/date/type, các ca prompt injection có nhãn fixture riêng, probe tài nguyên qua adapter thật, rồi tạo manifest runtime phiên bản mới trước test chính thức. Manifest M0 cũ được giữ để audit.
- Đây là hoàn thiện ban đầu trên dev, không dùng vòng cải tiến sau khi thất bại gate. Nếu test chính thức không đạt, vẫn phải hỏi nhánh (a)/(b) và tuân thủ tối đa một vòng cải tiến + test độc lập mới.
- Cho đến khi gate được xử lý, dữ liệu LLM chưa được coi là feature vận hành hợp lệ. Không thay đổi code booking hoặc migration tại bước này.

## Kết quả triển khai dev và đóng băng lại

- Schema phân biệt event/travel_disruption/hotel_offer, giữ trạng thái scheduled/updated/cancelled; thay đổi/hủy phải có đoạn dẫn chứng. Code loại xung đột trạng thái khỏi danh sách sự kiện đang dùng, giữ facts gốc để audit; chưa tự suy đoán bản nào thắng.
- Code chuẩn hóa khoảng ngày có năm dùng chung chỉ trong cùng đoạn occurrence có dẫn chứng rõ; không dùng năm đăng/đồng hồ hoặc đoán qua năm. LLM có thể trích `occurrence_year_quote` trong cùng đoạn; thiếu/mơ hồ thì loại. Địa lý hiện chỉ nhận literal Đà Nẵng, chưa mở rộng alias chưa kiểm chứng.
- Chọn đoạn ngày có ngân sách; bỏ riêng dòng metadata CMS nhận diện được, không bỏ ngày trong thân bài. Các phần bị bỏ vì giới hạn byte/token có diagnostics; kết quả không đại diện cho phần chưa đọc.
- Hai lượt probe trên 3 văn bản dev, không dùng test: prompt đầu loại cả hai dự đoán dương sai grounding; prompt sau trích được khoảng lễ hội năm mới 30-12-2026 đến 03-01-2027, còn bỏ sót Pickleball và các thông tin thành phần. Không có precision/recall chính thức. Cả 5 fixture injection trả rỗng ở mỗi lượt; đây chỉ là 5 ca kiểm tra, không chứng minh miễn nhiễm mọi tấn công.
- Checkpoint JSON bền vững, khóa cache gồm version/digest/hash văn bản, khôi phục queued/running còn hạn; đọc cache không làm mới tuổi dữ liệu. Collector preview cũ bị tắt trong launcher để không vượt registry/hạn mức mới.
- Runtime `hotelai-ai-v1-qwen-runtime-2` đóng băng tại `artifacts/hotelai-ai-v1/20261029-092250/M2/runtime-freeze-v2/runtime.json`. Model, quantization, context, output, worker/CPU giữ nguyên. Probe adapter thật cùng stack: RAM khả dụng tối thiểu 2,7674 GiB; 5 health qua. Không phải gate p95.
- Sau manifest v2, không chỉnh tiếp prompt/schema/chuẩn hóa ảnh hưởng suy luận khi chưa được duyệt. Vẫn chờ duyệt nhãn test + mẫu dev, rồi mới chạy test chính thức; vòng cải tiến sau thất bại gate chưa được sử dụng.
