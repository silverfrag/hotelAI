# HotelAI AI v1 — kế hoạch hợp nhất được duyệt

Người dùng duyệt triển khai bằng thông điệp “PLEASE IMPLEMENT THIS PLAN” ngày 2026-10-29. Các mặc định đề xuất trong bản này được dùng cho lần triển khai; mọi điểm duyệt tiếp theo vẫn bắt buộc. Bản gốc được gửi khi chưa viết code, thay đổi cấu hình hoặc khởi động dịch vụ. [SỬA]/[THÊM] giữ dấu rà soát của bản được duyệt.

## 1. Mục tiêu, phạm vi và cách làm việc

Xây dựng hệ thống AI định giá tích hợp vào website khách sạn, phục vụ **mọi loại phòng và kỳ lưu trú nhiều đêm tại Đà Nẵng**.

Luồng tổng thể:

**Thu thập thị trường → kiểm chứng nguồn → chuẩn hóa ngữ cảnh → dự đoán conversion → tối ưu báo giá → exposure → booking/outcome → xuất dữ liệu để học và đánh giá lại.**

Trách nhiệm từng thành phần:

- **Collector:** thu thời tiết, báo giá, lịch sự kiện và thông báo thị trường.
- **Qwen3 local:** trích đoạn và phân loại thông tin phi cấu trúc; không chọn giá hoặc tự tạo phần trăm ảnh hưởng.
- **Code chuẩn hóa:** chuẩn hóa ngày, địa danh, đơn vị và điều kiện báo giá; kiểm tra dẫn chứng và hợp đồng dữ liệu.
- **Mô hình conversion:** dự đoán xác suất khách chấp nhận báo giá cho một phòng trong toàn kỳ lưu trú và tạo booking.
- **Bộ tối ưu:** so sánh phương án giá trong giới hạn kinh doanh.
- **Backend khách sạn:** quyết định tồn phòng, phát hành quote, bảo toàn giá khi booking và ghi nhận kết quả.

Chuẩn nghiệm thu là **đồ án end-to-end**, triển khai trên máy hiện tại, không dùng API model trả phí. Conversion chưa đủ dữ liệu là kết quả hợp lệ: hệ thống xuất readiness report, dùng giá chính sách và không tạo xác suất giả.

Phạm vi định giá là **theo đêm**. Chưa xây mới tối ưu thuê theo giờ hoặc conversion chung cho giỏ nhiều phòng; các luồng hiện có phải được giữ tương thích.

### [THÊM] Quy trình sau khi duyệt

1. Làm trên nhánh Git riêng `feat/hotelai-ai-v1`; nếu tên đã tồn tại, dùng hậu tố run ID.
2. Kiểm kê và bảo toàn thay đổi có sẵn; không reset, xóa hoặc gom thay đổi không liên quan vào commit.
3. Lưu bản kế hoạch được duyệt tại **`docs/HOTELAI_AI_V1_PLAN.md`**.
4. **Đọc lại file này ở đầu mỗi milestone**, kiểm tra các quyết định bổ sung trong chat và cập nhật nhật ký thực hiện.
5. Thực hiện M0 trước mọi triển khai chức năng AI/collector.
6. Không đổi phạm vi, gate hoặc điều kiện miễn trừ mà chưa được người dùng duyệt.

**Bắt buộc:** hạ tầng; collector hoặc nhánh xử lý được duyệt; Qwen3 và đánh giá hoặc nhánh xử lý không đạt gate được duyệt; vòng dữ liệu quote–exposure–booking–outcome; exporter; readiness report; fallback đúng nguồn; admin chỉ đọc; lab/benchmark có nhãn; kiểm thử end-to-end; triển khai local; báo cáo.

**Tùy thời gian:** nút refresh/xuất dataset trên admin và trau chuốt UI. Refresh/export bằng CLI vẫn bắt buộc.

## 2. M0 — hạ tầng và ngân sách tài nguyên

M0 phải xác nhận:

- Docker hoạt động.
- PostgreSQL, Redis và Kafka chạy trong Compose riêng cho demo.
- Next.js, NestJS, FastAPI, Ollama và Qwen3 hoạt động.
- Toàn stack lên bằng một lệnh sau khi prerequisites đã có.
- Launcher có **`start` / `stop` / `status`**, health check đủ dịch vụ và log rõ ràng.
- Backup DB demo và restore sang một DB thử riêng thành công.
- Không dùng hoặc ghi đè database vận hành hiện có.

Cấu hình đã quan sát:

- Intel Core i7-1165G7, 4 nhân/8 luồng.
- Khoảng 16 GB RAM; lần đo gần nhất còn khoảng 5,6 GiB trống.
- GPU tích hợp Intel Iris Xe; chưa coi đây là nguồn VRAM đủ dùng cho LLM.
- Docker daemon chưa chạy tại lần kiểm tra.
- Qwen3 1.7B Q4_K_M đã chạy riêng; chưa chứng minh toàn stack đạt yêu cầu dưới tải.

### [SỬA] Ngân sách RAM phải dựa trên đo tổng thể

Không coi ngân sách cũ **3,5 GiB Ollama + 3 GiB hạ tầng** là cấu hình đã khả thi: tổng này vượt RAM trống đã đo và chưa tính đầy đủ Next/Nest/FastAPI.

M0 đo từng bước: baseline máy → hạ tầng → ứng dụng production → Qwen3 khi suy luận → toàn stack dưới tải. Lưu RAM/CPU đỉnh, thời gian khởi động và dấu hiệu áp lực bộ nhớ. Phân biệt giới hạn cưỡng chế được với ngưỡng chỉ giám sát.

**Đề xuất ngưỡng vận hành:** còn ít nhất 1,5 GiB RAM khả dụng trong thử nghiệm; nếu không đạt, phải giảm tài nguyên nền trong phạm vi cho phép và đo lại. Không coi đây là bằng chứng đủ thay cho test p95.

### [THÊM] Những điều được tự điều chỉnh trước khi đóng băng runtime

Được điều chỉnh và ghi lý do/kết quả, không phải hỏi lại:

- Kafka heap trong khoảng khởi điểm 256–512 MiB.
- Ollama `keep_alive` trong khoảng 0–15 phút.
- Context Qwen3 trong khoảng 4.096–8.192 tokens, đồng thời điều chỉnh ngân sách đầu vào để tránh cắt dữ liệu âm thầm.
- Giữ một job suy luận đồng thời; thử 1–2 luồng CPU.
- Dùng production build thay dev server.
- Hoãn job nền khi áp lực tài nguyên cao; không tự dừng ứng dụng khác của người dùng.
- Thực hiện build tuần tự, không build nặng trong lúc đo hiệu năng.

**Phải hỏi:** đổi model/quantization, tải model khác, bỏ Kafka hoặc dịch vụ bắt buộc, cài thành phần ngoài plan, thay đổi thiết lập máy ngoài phạm vi được duyệt, hoặc nới gate.

**[THÊM] Đóng băng runtime Qwen3 trước test chính thức:** model/digest, quantization, context, ngân sách đầu vào/đầu ra, prompt, schema, tham số sinh và cấu hình worker. Sau đó, thay đổi có thể ảnh hưởng kết quả suy luận phải được duyệt và đánh giá lại; không vừa chấm test vừa chỉnh cấu hình.

Nếu không thể chạy đủ stack ổn định trên máy hiện tại, M0 dừng với số đo cụ thể. Không hứa trước rằng cấu hình này chắc chắn đạt p95.

## 3. Collector, hạn mức và bằng chứng thị trường

### 3.1. Nguồn giá khách sạn

Khảo sát Pullman, InterContinental, HAIAN và Monarque; không mặc định booking engine của họ cho phép thu tự động.

**[SỬA] Giới hạn 20 request chỉ áp dụng cho khảo sát khả thi nguồn giá khách sạn.** Tính cả robots/điều khoản, redirect và retry đến website/booking engine liên quan. Không mở lại hạn mức bằng đổi tên miền phụ hoặc phiên chạy.

Quy tắc bắt buộc cho mọi hoạt động thu thập:

- Chỉ truy cập công khai, tuân thủ robots.txt, điều khoản và rate limit.
- Không tiếp tục nếu chưa làm rõ quyền truy cập tự động.
- Cấm giải CAPTCHA, đăng nhập/dùng tài khoản, giả mạo trình duyệt hoặc danh tính, xoay IP/proxy, giải mã token chống bot hay cách khác để vượt chặn.
- Gặp 403, CAPTCHA hoặc điều khoản cấm: dừng nguồn ngay, ghi `blocked`.
- Thiếu trường giá quan trọng: ghi `insufficient_data`.
- Với 429, tôn trọng `Retry-After`; không vượt ngân sách request.
- Lưu URL, mã phản hồi/dấu hiệu chặn, trích điều khoản, timestamp và hash. Không lưu secrets, cookie hoặc token.

Báo giá hợp lệ phải có: khách sạn, loại phòng, ngày nhận/trả, số khách, tiền tệ, thuế, bữa ăn, hoàn hủy và thời điểm quan sát.

Ánh xạ theo nhóm phòng và điều kiện lưu trú; không so villa/penthouse với phòng tiêu chuẩn. So sánh cùng kỳ ở. Giá bình quân mỗi đêm không được biến thành bảng giá từng đêm nếu nguồn chỉ cung cấp tổng.

### 3.2. Khi collector chưa đủ điều kiện

Nếu có dưới hai khách sạn hợp lệ, dừng nhánh collector, lưu bằng chứng và hỏi:

- **(a)** Khóa v1 với “độ phủ giá đối thủ không đủ”: tắt feature giá đối thủ, hiện rõ ở admin và báo cáo.
- **(b)** Người dùng cung cấp nguồn/quyền truy cập khác.

Tiếp tục các bước độc lập.

**Theo quyết định đã chốt:** chọn (b) thì **chưa khóa v1** cho đến khi nguồn mới chạy được và được kiểm chứng, hoặc người dùng chuyển sang (a). Xác nhận (b) chỉ chốt hướng xử lý, không chứng minh collector hoạt động.

Nguồn/quyền truy cập mới không tự miễn trừ các điều cấm. Nếu cần cách truy cập ngoài plan, phải duyệt thay đổi trước.

Ở nhánh (a), loại feature giá đối thủ khỏi hợp đồng phiên bản đó. Không điền số trung tính và không nạp model còn yêu cầu feature đã tắt.

### 3.3. [THÊM] Registry văn bản và hạn mức riêng

**Danh sách tên miền đề xuất để người dùng duyệt trước khi thu văn bản:**

| Tên miền | Mục đích dự kiến |
|---|---|
| `danangfantasticity.com` | Lịch, sự kiện và thông tin du lịch |
| `startupdanang.vn` | Chương trình giao thương, hội nghị và sự kiện |
| `danang.gov.vn` | Thông báo chính thức của thành phố |
| `cttdt.danangportal.gov.vn` | Nội dung cổng thông tin thành phố; kiểm tra quan hệ redirect với tên miền trên |
| `baodanang.vn` | Tin địa phương và thông báo cần đối chiếu nguồn |

Đây là danh sách xin duyệt, chưa phải xác nhận mọi nguồn đều cho phép thu. Redirect sang tên miền chưa được duyệt không tự mở rộng registry.

**Hạn mức đề xuất:**

| Hoạt động | Ngân sách request | Khoảng cách tối thiểu |
|---|---:|---:|
| Khảo sát khả thi giá khách sạn | 20 request/nguồn cho toàn đợt | 5 giây cùng nguồn |
| Thu corpus Qwen3 | 200 request/toàn đợt, tối đa 50/tên miền được duyệt | 5 giây cùng tên miền |
| Thu giá vận hành | 12 request/giờ, tối đa 96/ngày/nguồn | 10 giây cùng nguồn |
| Sự kiện/thông báo vận hành | 10 request/lần chạy, tối đa 40/ngày/tên miền | 10 giây cùng tên miền |
| Thời tiết | 2 request/lần chạy, tối đa 16/ngày | 5 giây |

- Tối đa hai request mạng đồng thời toàn worker.
- Redirect, retry, robots và điều khoản đều tính vào ngân sách tương ứng.
- Robots/điều khoản/rate limit nghiêm hơn thì dùng giới hạn nghiêm hơn.
- Ngân sách hết thì hoãn hoặc báo thiếu dữ liệu, không tự tăng.
- Nguồn đã bị chặn không được thử lại thông qua ngân sách của hoạt động khác.
- Hạn mức corpus cũng phải đủ cho bộ test mới nếu chọn vòng cải tiến Qwen3; cần vượt ngân sách thì hỏi trước.

### 3.4. Chu kỳ và độ mới

| Dữ liệu | Chu kỳ | Độ cũ tối đa |
|---|---:|---:|
| Giá cho truy vấn đang được quan tâm | 1 giờ | 2 giờ |
| Thời tiết | 3 giờ | 6 giờ |
| Sự kiện/thông báo | 6 giờ | 12 giờ |

Độ cũ tính từ quan sát thành công, không đặt lại khi đọc cache. Quá hạn không được dùng làm feature; admin hiện thiếu dữ liệu.

Kiểm tra riêng hiệu lực sự kiện và horizon dự báo. Dữ liệu mới tải không đồng nghĩa áp dụng được cho ngày lưu trú.

Giữ raw response, URL, timestamp, hash và parser version. Live/replay tách biệt: replay giữ nguyên thời điểm quan sát, không đi vào dataset conversion vận hành như một quan sát mới.

## 4. Feature contract và Qwen3

### 4.1. [THÊM] Định nghĩa “ngữ cảnh bắt buộc” và độ bao phủ

**Dữ liệu cốt lõi bắt buộc, bao phủ 100% số đêm:**

- Loại phòng, sức chứa, số khách, ngày nhận/trả và lịch theo múi giờ khách sạn.
- Tồn phòng/khả dụng từ backend cho toàn kỳ ở.
- Giá chính sách từng đêm, phiên bản chính sách, sàn/trần và các chi phí/ràng buộc cần thiết.

Không có tồn phòng, lịch hoặc giá chính sách hợp lệ thì **không phát hành quote mới**. Không thể dùng “fallback” để tự bịa dữ liệu cốt lõi. Quote đã phát hành tiếp tục theo quy tắc TTL và xác nhận tồn phòng hiện có.

**Nhóm thị trường được phép thiếu một phần hoặc được tắt theo hợp đồng đã duyệt:**

| Nhóm đang bật | Ngưỡng đề xuất | Cách xác định |
|---|---:|---|
| Thời tiết | Ít nhất 80% số đêm | Có dự báo hợp lệ, còn mới, đúng địa điểm và ngày |
| Sự kiện/thông báo | 100% số đêm được đánh giá trong phạm vi nguồn đã công bố | Snapshot còn mới, pipeline hợp lệ và có phạm vi ngày bao phủ kỳ ở |
| Giá đối thủ | 100% kỳ ở | Ít nhất hai khách sạn có báo giá so sánh được cho toàn kỳ ở |

Lý do giá đối thủ là 100%: không ghép giá từng đoạn không tương đương rồi coi đó là báo giá cùng kỳ lưu trú.

“Bao phủ sự kiện” là bao phủ kỹ thuật của tập nguồn đã khai báo, **không chứng minh thị trường không còn sự kiện khác**. Không đánh dấu bao phủ chỉ vì tải được một bài hoặc không trích được sự kiện. Nguồn chỉ có thông tin rời rạc mà không xác lập được phạm vi ngày phải ghi thiếu bao phủ.

**Quy tắc áp dụng:**

- Với nhóm đang bật, dưới ngưỡng thì dùng giá chính sách; không có xác suất conversion được trình bày như hợp lệ.
- Nhóm bị tắt theo nhánh xử lý đã duyệt không còn là điều kiện bao phủ của phiên bản đó.
- Không được tự tắt nhóm ở runtime để vượt gate. Trạng thái bật/tắt và ngưỡng nằm trong feature contract, metadata model và readiness.
- Nếu model conversion chưa sẵn sàng, luôn dùng chính sách, bất kể dữ liệu thị trường đã đủ.

**Xử lý train:**

- Lưu `null`, missing mask, số đêm có dữ liệu, tỷ lệ bao phủ và lý do thiếu; không dùng 0 thay cho “không biết”.
- Với thời tiết đủ ngưỡng nhưng thiếu một số đêm, thống kê chỉ tính trên đêm đã quan sát, kèm tỷ lệ bao phủ.
- Tiền xử lý được fit trên train, không nhìn test.
- Dòng dưới ngưỡng vẫn được exporter lưu để audit nhưng không vào tập học của model yêu cầu ngưỡng đó.
- “Không phát hiện sự kiện trong phần đã đánh giá” khác với “chưa đánh giá”.
- Khi tắt nhóm feature, tạo hợp đồng/model version tương ứng; không sửa ngầm vector của model cũ.

### 4.2. Trách nhiệm đọc hiểu

Dữ liệu có cấu trúc đi thẳng qua chuẩn hóa. Qwen3 xử lý sự kiện/lễ hội, gián đoạn đi lại–du lịch, ưu đãi và điều kiện bán phòng.

**[SỬA] LLM chỉ trích đoạn và phân loại; không chắc thì bỏ.** Code được phép:

- Chuẩn hóa ngày từ bằng chứng có đủ thành phần cần thiết, không tự đoán năm.
- Chuẩn hóa địa danh qua bảng ánh xạ có phiên bản, không đoán địa điểm mơ hồ.
- Kiểm tra đơn vị, hiệu lực, dẫn chứng và gộp trùng.
- Đánh dấu xung đột/cập nhật/hủy sự kiện.

Mỗi thông tin có loại, địa lý, khoảng hiệu lực và dẫn chứng. Không suy ra phần trăm tác động hoặc nhân quả từ tin tức.

Qwen3 chạy nền, một job đồng thời; snapshot/job lưu bền vững. Đường xin quote không chờ LLM.

### 4.3. Bộ tham chiếu và gate Qwen3

- Ít nhất **60 văn bản thật**: 30 dev, ít nhất 30 test.
- Ít nhất 25% âm; mỗi tập 30 có ít nhất 8 văn bản không chứa thông tin hợp lệ.
- Khoảng 100 văn bản là mục tiêu mở rộng nếu khả thi; phải chốt trước khi khóa test, không thêm/bớt theo kết quả.
- Không để bài trùng hoặc cùng sự kiện gây rò rỉ giữa dev/test.
- Trợ lý soạn nhãn từ văn bản gốc; người dùng duyệt toàn bộ test và mẫu dev.
- Không dùng Qwen3 tự gán nhãn rồi chấm chính nó.

**[THÊM] Gửi sớm gói nhãn nháp gồm 30 test + 10 dev**, kèm nguồn, văn bản, nhãn đề xuất, dẫn chứng và trường hợp không chắc. Người dùng duyệt song song trong khi làm các phần độc lập. Chưa được duyệt thì chưa chấm test chính thức.

Một thông tin đúng phải khớp loại, phạm vi địa lý, thời gian hiệu lực và dẫn chứng hỗ trợ nhận định. Ghép dự đoán–nhãn một–một; không thưởng cho đầu ra lặp.

Gate ước lượng điểm: **precision ≥ 90%, recall ≥ 70%**. Báo CI 95%, số văn bản và số thông tin; đề xuất bootstrap theo văn bản/nhóm bài liên quan 1.000 lần, seed cố định.

Kiểm tra tự động:

- JSON schema bắt buộc.
- Dẫn chứng xuất hiện nguyên văn sau chuẩn hóa khoảng trắng; không dùng so khớp mờ để hợp thức hóa diễn giải.
- Sai schema, ngày, địa lý hoặc dẫn chứng thì loại và lưu lý do.
- Qwen3 không có tool, trình duyệt hoặc khả năng gọi mạng để thực hiện chỉ dẫn trong văn bản.
- Ít nhất 5 ca prompt injection có kiểm soát, gắn nhãn đối kháng; không tính chúng vào số văn bản thật.

### 4.4. [THÊM] Khi Qwen3 không đạt gate

Dừng nhánh nghiệm thu Qwen3, lưu kết quả và hỏi người dùng chọn:

- **(a) Khóa v1 với “ngữ cảnh LLM chưa đạt gate”:** đầu ra từ văn bản phi cấu trúc không vào feature vận hành; chỉ dùng dữ liệu có cấu trúc hợp lệ. Hiện trạng thái ở admin và báo cáo; hợp đồng feature loại phần bị tắt.
- **(b) Một vòng cải tiến tối đa trên dev:** giữ model/gate, cải tiến prompt, chuẩn hóa hoặc xử lý đầu vào trên dev; sau đó dùng **một bộ test độc lập mới ít nhất 30 văn bản**, ít nhất 25% âm, do người dùng duyệt toàn bộ.

Bộ test đã dùng được giữ làm bằng chứng, không dùng để chỉnh prompt/ngưỡng. Runtime phải được đóng băng lại trước test mới.

Nếu vòng (b) vẫn không đạt, dừng và hỏi chọn (a) hoặc duyệt thay đổi kế hoạch. Không tự mở vòng cải tiến thứ hai. Đổi model hoặc hạ gate luôn phải hỏi.

## 5. Conversion, tối ưu và tích hợp ứng dụng thật

### 5.1. Mô hình và gate conversion

Dùng Logistic Regression có regularization làm model cốt lõi đầu tiên. Feature gồm loại phòng, số khách, số đêm, giá chào tương đối, tồn phòng, lịch và các nhóm thị trường đang bật.

Lưu ngữ cảnh từng đêm rồi tổng hợp cho cả báo giá; không nhân xác suất từng đêm.

Gate:

- Ít nhất 500 quan sát hợp lệ trong 28 ngày.
- Ít nhất 50 positive và 50 negative.
- Chia theo thời gian, loại nhãn chưa hoàn tất tại cutoff; mỗi partition có ít nhất 20 mẫu mỗi lớp.
- Có biến thiên giá đủ theo kiểm tra hiện tại; ngăn cùng hành trình lọt sang train và test.
- Brier/log loss tốt hơn baseline, ECE ≤ 0,10 và quan hệ giá hợp lệ.
- Nhóm áp dụng đề xuất: loại phòng × số đêm `1`, `2–3`, `4–7`, `8–30`, `>30`. Nhóm chỉ được đánh giá/áp dụng khi tập kiểm tra có ≥20 positive và ≥20 negative; nhóm thiếu dùng chính sách.
- Báo thêm theo từng loại phòng và khoảng đêm khi đủ mẫu.

Brier, log loss, ECE và chênh lệch với baseline có CI 95%, cỡ mẫu và số nhóm bootstrap; đề xuất 1.000 lần bootstrap theo hành trình.

**[SỬA] Quy tắc “CI rộng hơn 2× trị tuyệt đối ước lượng” chỉ áp dụng cho:**

- Chênh lệch metric so với baseline.
- ECE.

Không áp dụng quy tắc này cho trị tuyệt đối Brier hoặc log loss. Vẫn báo CI của tất cả metric. Gắn “bằng chứng yếu” khi CI không phân biệt được với baseline, cắt mốc gate liên quan hoặc rộng theo quy tắc trên. Cảnh báo không âm thầm thay gate điểm.

Artifact đạt gate chỉ vào shadow; không tự áp dụng giá khách thật. V2 Bồ Đào Nha và artifact mô phỏng chỉ thuộc benchmark có nhãn.

### 5.2. Nhãn, exposure và exporter

Tận dụng quote, ledger và booking hiện có; bổ sung context/decision/model/policy version và giá từng đêm.

- Exposure khi quote thực sự hiển thị; chống trùng và lọc bot/crawler nhận diện được, health check, request nội bộ, seed và test traffic.
- Lưu chính sách/version, đầu vào chính sách, giá hiển thị và propensity.
- V1 tất định: propensity của hành động được chọn = 1; không randomize giá thật. Đây không phải xác suất chấp nhận.
- Shadow lưu giá đề xuất và xác suất tại giá đề xuất/giá hiển thị khi model sẵn sàng; không hiển thị cho khách.
- Outcome chỉ gắn với giá đã hiển thị.
- Positive: backend tạo booking thành công từ quote.
- Negative: `explicit_reject` hoặc `expired_no_accept`; giữ khoảng chờ đối soát 24 giờ sau hết hạn.
- Đổi lựa chọn/đóng trang không tự thành từ chối vì giá. Trường hợp lỗi hoặc chưa xác nhận exposure không vào tập học.
- Thanh toán, hủy và hoàn tất lưu trú là kết quả riêng, không ghi đè nhãn chấp nhận.
- Báo kết quả theo `negative_reason` khi đủ mẫu.

**[THÊM] Exporter lưu quan hệ quote bị thay thế trong cùng hành trình:** `is_superseded`, mã quote thay thế và thời điểm thay thế. Đây là thuộc tính để phân tích/lọc về sau, không tự biến quote cũ thành “khách nhạy cảm giá”.

Exporter tự nối quote–exposure–context–outcome; loại tên/email/SĐT/IP. Mã hành trình cần giữ được giả danh bằng HMAC; khóa không đi kèm dataset. Phân biệt vận hành, người thử, seed, fixture và replay.

### 5.3. Bộ tối ưu và làm tròn

Tạo 101 hệ số từ **0,80–1,30, bước 0,005**, luôn có 1,00 trong tập ban đầu. Áp dụng hệ số chung lên giá chính sách từng đêm.

**[THÊM] Đơn vị làm tròn đề xuất: 1.000 VND/phòng/đêm**, dùng decimal và quy tắc half-up; không dựa vào sai số floating point. Đường chính sách và đường AI phải dùng quy tắc đã được duyệt tại M3 để 1,00 thực sự tương ứng giá chính sách.

Sau làm tròn:

- Kiểm tra sàn/trần, chi phí và các ràng buộc từng đêm.
- Loại phương án vi phạm hoặc ngoài miền đã học.
- Tổng kỳ ở bằng đúng tổng giá các đêm đã làm tròn.
- Tập còn lại có thể ít hơn 101.
- Nếu 1,00 ngoài miền model: fallback chính sách, không gắn xác suất AI.
- Nếu chính giá chính sách không hợp lệ theo ràng buộc kinh doanh, báo lỗi cấu hình/nghiệp vụ; không trả giá vi phạm.

Mục tiêu là biên đóng góp kỳ vọng trên một quote được nhìn thấy; không tuyên bố đây là doanh thu thực thu hoặc tối ưu toàn khách sạn.

**[THÊM] Test optimizer bằng model giả gắn nhãn `test_fixture`:**

- Mọi ứng viên còn lại nằm trong sàn/trần từng đêm.
- Tổng bằng tổng các đêm sau làm tròn.
- Kiểm tra ngưỡng làm tròn, sàn lớn hơn trần, không còn ứng viên và đồng hạng.
- 1,00 ngoài miền dẫn tới fallback không xác suất.
- Giá được chọn đúng cực đại trên tập ứng viên hợp lệ của fixture.

Fixture không được nạp vào model registry vận hành, ghi vào dữ liệu khách thật hoặc dùng chứng minh accuracy.

### 5.4. API, quản trị và điểm duyệt M3

Giữ API quote/event; bổ sung tương thích `decision_id`, `context_snapshot_id`, chế độ giá và chi tiết từng đêm. Booking dùng tổng đã lưu, không tính lại khi xác nhận.

Hợp đồng market decision hỗ trợ loại phòng, ngày nhận/trả và số khách; endpoint một đêm giữ qua lớp chuyển đổi. Artifact sai hợp đồng bị từ chối.

- TTL quote: 30 phút; giá snapshot bất biến trong TTL, vẫn phải xác nhận tồn phòng/tính hợp lệ khi booking.
- Timeout suy luận giá trực tuyến đề xuất 750 ms; quá hạn/lỗi thì chính sách đúng nguồn.
- Timeout Qwen3 nền riêng, mặc định 240 giây.
- **Trình duyệt không được truyền URL tùy ý để backend cào.** Nguồn chỉ đến từ registry đã duyệt phía server.
- API quản trị bắt buộc xác thực và phân quyền admin.
- Refresh/export bằng API hoặc CLI có audit actor, thời gian, phạm vi và kết quả; không ghi PII.
- Admin bắt buộc chỉ cần xem nguồn, coverage, trạng thái gate, readiness, fallback và lineage. Nút thao tác là tùy chọn.

**[THÊM] Trước khi sửa code booking hoặc migration tại M3, phải dừng gửi thiết kế để người dùng duyệt.** Gói thiết kế gồm API/schema, chuyển trạng thái, bất biến quote/booking, tương thích dữ liệu cũ, migration mới, rollback và test. Được tiếp tục phần độc lập trong lúc chờ; không sửa trước rồi xin duyệt sau.

## 6. Milestone, bằng chứng và nghiệm thu

Kho bằng chứng thống nhất:

**`artifacts/hotelai-ai-v1/<run-id>/M0…M6/`**

Lưu ngay ở từng mốc: log đã lọc secrets/PII, cấu hình, test result, ảnh UI khi phù hợp, commit hash, hash snapshot/diff nếu dirty, manifest SHA-256 và quyết định được duyệt. Raw/artifact lớn có thể không đưa vào Git nhưng phải có trong gói bàn giao và manifest.

| Mốc | Tiêu chí xong | Bằng chứng | Điểm dừng |
|---|---|---|---|
| **M0 — Hạ tầng** | Một lệnh lên stack; start/stop/status; đủ health check; backup/restore DB demo; chốt tài nguyên và runtime Qwen3 | Máy/runtime/model manifest, log tài nguyên, health, backup hash, restore report | Không đủ tài nguyên, Docker lỗi, cần thành phần ngoài plan hoặc tác động dữ liệu cũ |
| **M1 — Collector và hợp đồng** | ≥2 khách sạn thu tự động hợp lệ cho một/nhiều đêm; hoặc (a) được duyệt và feature đã tắt. Với (b), chờ nguồn mới đạt. Hợp đồng coverage được chốt | Request ledger, robots/điều khoản, raw/hash, mapping, so sánh giá, quyết định nhánh | Nguồn bị chặn; <2 khách sạn; hết ngân sách khảo sát |
| **M2 — Context/Qwen3** | Pipeline bền vững; nhãn được duyệt; đạt gate, hoặc nhánh (a) được duyệt và feature LLM đã tắt. Nhánh (b) tuân thủ một vòng cải tiến và test mới | Gói nhãn sớm, phê duyệt, split/model/prompt hash, outputs, metrics/CI, injection tests | Chưa duyệt registry/nhãn; gate thất bại; cần đổi model/gate hoặc vòng cải tiến thứ hai |
| **M3 — Tích hợp và vòng học** | Thiết kế booking/migration đã được duyệt; quote/exposure/booking/outcome, exporter, readiness, admin chỉ đọc và fallback hoàn chỉnh | Thiết kế/phê duyệt, schema/migration mới, lineage, export đã lọc PII, integration tests | **Trước sửa booking/migration**; cần sửa migration cũ/xóa dữ liệu; lỗi thiết kế hệ thống |
| **M4 — E2E và RC** | Đạt test ứng dụng thật, mọi loại phòng/nhiều đêm, optimizer fixture, lỗi và p95 dưới tải | Logs, coverage, UI, load report, RC commit/manifest | Booking lỗi hệ thống; gate/p95 không đạt; cần đổi phạm vi |
| **M5 — Deploy demo local** | Dùng đúng RC khởi động lại; jobs/data phục hồi; demo thật và lab/replay tách biệt; backup/restore/rollback kiểm chứng | Deployment manifest, restart/health/restore logs, demo evidence | Không tái lập, mất dữ liệu hoặc phụ thuộc ngoài plan |
| **M6 — Duyệt khóa và báo cáo** | Người dùng duyệt gói nghiệm thu trước khóa; release manifest/runbook/rollback đầy đủ; Markdown và DOCX hoàn thành | Gói duyệt, release commit, manifest, báo cáo và claim→evidence | **Trước khóa release**; thiếu bằng chứng, claim không được hỗ trợ hoặc gate còn treo |

### Kiểm thử ứng dụng và hiệu năng

**[THÊM] Test booking bắt buộc chạy trên ứng dụng khách sạn thật**: Next.js → NestJS → PostgreSQL và dịch vụ AI liên quan. Không dùng server academic/rút gọn thay thế. Dữ liệu test nằm trong DB demo tách biệt.

Các kịch bản:

- Đủ 8 loại phòng hiện có; 1/2/7/30 đêm, qua tháng/năm, vượt horizon.
- Quote hết TTL, hết phòng, đặt đồng thời, retry và lỗi phản hồi sau commit.
- Exposure trùng/bot/internal, quote thay thế, nhãn chưa hoàn tất và các loại negative.
- Giá không so sánh được, nguồn bị chặn, snapshot cũ, replay.
- Artifact sai version, timeout, Ollama dừng và model chưa sẵn sàng.
- Migration mới, phục hồi job, backup/restore và rollback.

**p95 quote ≤2 giây với 5 phiên đồng thời khi Qwen3 đang suy luận và job refresh thực sự chạy.**

Đề xuất ít nhất 200 request đo/lượt, không tính warm-up. Lưu p50/p95/p99, lỗi, tỷ lệ fallback, CPU/RAM và thời gian hoạt động nền. Không pha phần lớn request lúc máy rảnh vào kết quả tải nền; không coi “mọi request đều fallback” là bằng chứng đường model hoạt động tốt.

### Khi Ollama dừng

- Snapshot hợp lệ còn hạn vẫn được dùng, ghi rõ nguồn và thời điểm.
- Thiếu/quá hạn dưới ngưỡng của nhóm đang bật hoặc model conversion chưa sẵn sàng thì chính sách.
- Nếu nhóm LLM đã tắt theo quyết định (a), Ollama dừng không làm thiếu dữ liệu cốt lõi.
- Không gọi Ollama đồng bộ trong checkout.

### [THÊM] Kịch bản demo hợp nhất

1. Ngữ cảnh thật kèm dẫn chứng hoặc trạng thái LLM chưa đạt gate.
2. Giá đối thủ cùng kỳ ở nếu collector đạt; nếu không, hiển thị coverage và nhánh xử lý.
3. Quote, shadow decision và lineage; conversion chưa sẵn sàng hiện readiness, không tạo giá/xác suất giả.
4. Tạo booking thật trong DB demo, chứng minh bảo toàn giá và ghi đúng exposure/outcome/export.
5. Tắt Ollama, kiểm tra snapshot còn hạn và trường hợp cần fallback.
6. Replay snapshot thật, gắn nhãn rõ.
7. **Lab/benchmark optimizer với model fixture:** hiển thị lưới giá, phương án bị loại và kết quả tối ưu, có nhãn nổi bật **“MÔ HÌNH GIẢ KIỂM THỬ — KHÔNG PHẢI DỰ BÁO THỊ TRƯỜNG”**. Không phát hành quote vận hành hoặc ghi dữ liệu học thật từ bước này.

## 7. Điều kiện dừng, khóa release và báo cáo

Dừng nhánh liên quan, lưu bằng chứng và báo người dùng khi:

- Collector dưới hai khách sạn hợp lệ.
- Qwen3 không đạt gate.
- Chưa được duyệt registry hoặc nhãn test.
- Đến điểm duyệt thiết kế booking/migration M3.
- Cần sửa migration đã áp dụng hoặc xóa dữ liệu cũ.
- Cần cài/tải ngoài plan hoặc phát sinh phí.
- Test booking lỗi do thiết kế hệ thống hiện có, không phải lỗi cục bộ.
- Cần đổi phạm vi/gate/model.
- Cùng một vấn đề bế tắc sau khoảng ba hướng thử hợp lý khác nhau.
- Đến điểm duyệt trước khóa M6.

Tiếp tục phần độc lập khi có thể. Nguồn bị chặn phải dừng ngay, không được viện quy tắc ba hướng thử để lách chặn.

### Khóa và báo cáo

Gói khóa gồm commit, dependency lockfiles, migration, registry, model/prompt/runtime/feature contract, dataset manifest, test evidence, cấu hình triển khai và rollback.

Sau khóa chỉ sửa lỗi; thay đổi nghiệp vụ hoặc model tạo version mới.

Báo cáo Markdown và DOCX theo mẫu đồ án, gồm kiến trúc, dữ liệu, phương pháp, thực nghiệm, triển khai, demo và claim→evidence. Bắt buộc nêu:

- Nhãn là chấp nhận báo giá, không phải nhạy cảm giá thuần.
- Hệ số giá có thể lẫn với mùa vụ, sự kiện, đối thủ và chính sách chọn giá.
- Propensity tất định không cho phép suy ra hiệu quả của giá chưa đưa cho khách.
- Chưa chứng minh nhân quả hoặc doanh thu tăng.
- Nhóm thiếu mẫu, CI yếu, nguồn bị chặn, Qwen3 không đạt/đầu ra bị loại.
- Fixture, seed, replay và người thử không được trình bày như dữ liệu thị trường đại diện.

### [SỬA] Mục tiêu cho Goal sau khi duyệt

> Làm trên nhánh Git riêng, lưu kế hoạch hợp nhất được duyệt tại `docs/HOTELAI_AI_V1_PLAN.md` và **đọc lại file này ở đầu mỗi milestone**. Hoàn thiện M0–M6: stack local một lệnh với start/stop/status, health check và backup/restore; collector hoặc nhánh xử lý được duyệt; Qwen3 và đánh giá hoặc nhánh không đạt gate được duyệt; feature contract/coverage; quote–exposure–booking–outcome; exporter; readiness; fallback đúng nguồn; admin chỉ đọc; lab optimizer có nhãn; e2e ứng dụng thật; demo local; khóa release và báo cáo.
>
> **Test booking phải chạy trên ứng dụng thật, không dùng server rút gọn. Trình duyệt không được truyền URL tùy ý để backend cào.**
>
> Collector đạt bằng ≥2 khách sạn thu tự động hợp lệ hoặc nhánh (a) được người dùng xác nhận với feature giá đối thủ đã tắt. Nhánh (b) đóng quyết định xử lý nhưng chưa cho khóa release: chờ nguồn mới chạy và được kiểm chứng hoặc người dùng chuyển sang (a).
>
> Qwen3 không đạt gate phải dừng hỏi: (a) tắt feature từ văn bản phi cấu trúc, chỉ dùng dữ liệu cấu trúc và công bố chưa đạt gate; hoặc (b) tối đa một vòng cải tiến trên dev rồi test độc lập mới do người dùng duyệt. Đổi model, hạ gate hay thêm vòng cải tiến phải xin duyệt.
>
> Chỉ truy cập công khai, tuân thủ robots, điều khoản và rate limit. Khảo sát nguồn giá tối đa 20 request/nguồn; thu corpus và vận hành theo hạn mức riêng trong plan. Cấm CAPTCHA, đăng nhập/tài khoản, giả mạo trình duyệt/danh tính, xoay IP/proxy, giải mã token chống bot hoặc cách vượt chặn khác. Gặp chặn phải dừng nguồn và lưu bằng chứng.
>
> Dừng và báo tại các điểm bắt buộc: collector thiếu nguồn; Qwen3 không đạt; cần duyệt registry/nhãn; **trước sửa code booking/migration M3**; cần sửa migration đã áp dụng/xóa dữ liệu cũ; cài/tải ngoài plan hoặc tốn phí; lỗi booking thuộc thiết kế hệ thống; đổi phạm vi/gate/model; bế tắc sau khoảng ba hướng thử; và **trước khóa M6**. Tiếp tục phần độc lập nhưng không tự miễn trừ gate.
>
> Conversion chưa sẵn sàng là kết quả hợp lệ nếu pipeline/readiness/fallback hoàn chỉnh. Không tạo dữ liệu giả để đạt gate, không randomize giá thật, không tự kích hoạt model hoặc tuyên bố hiệu quả chưa đo. Lab fixture chỉ chứng minh phần mềm optimizer chạy đúng, không chứng minh dự báo thị trường.
>
> Lưu bằng chứng ngay theo từng milestone. Không hoàn thành Goal khi thiếu hạng mục bắt buộc hoặc còn điểm duyệt/gate chưa được xử lý. Refresh/export qua UI và trau chuốt UI là tùy chọn.

## 8. Danh sách thay đổi và điểm không đồng ý

### Thay đổi lần rà soát cuối

1. Thêm hai nhánh khi Qwen3 không đạt, giới hạn một vòng cải tiến và test mới.
2. Định nghĩa dữ liệu cốt lõi, coverage từng nhóm thị trường và xử lý thiếu trong train.
3. Sửa ngân sách RAM thành đo thực tế; quy định phần tự chỉnh và phần phải hỏi; đóng băng runtime.
4. Khôi phục rõ test booking ứng dụng thật, cấm URL từ trình duyệt, launcher start/stop/status.
5. Thêm optimizer fixture, đơn vị làm tròn 1.000 VND và bước demo lab riêng.
6. Thêm nhánh Git, file plan, điểm duyệt trước M3/M6 và gói nhãn gửi sớm.
7. Tách hạn mức khảo sát giá, corpus và vận hành; bổ sung registry văn bản cần duyệt.
8. Giới hạn quy tắc CI rộng đúng đối tượng; thêm thuộc tính quote bị thay thế.

### Điểm không đồng ý hoặc cần lưu ý tại thời điểm lập plan

- **Không có điểm phản đối với các yêu cầu mới.**
- Không coi ngân sách RAM cũ hoặc việc Qwen3 chạy riêng là bằng chứng toàn stack khả thi. M0 phải đo; hiện chưa cam kết được gate p95.
- Dữ liệu cốt lõi thiếu thì phải từ chối phát hành quote mới, không thể fallback bằng số tự suy ra. Dữ liệu thị trường thiếu mới áp dụng quy tắc coverage/chính sách.
- Coverage sự kiện chỉ mô tả phạm vi nguồn đã đánh giá, không chứng minh sự vắng mặt của mọi sự kiện trên thị trường.
- Các giá trị coverage 80%/100%/100%, hạn mức corpus/vận hành, làm tròn 1.000 VND và khoảng tự điều chỉnh tài nguyên là đề xuất được chấp nhận khi người dùng yêu cầu triển khai bản kế hoạch này. Điểm duyệt riêng registry, nhãn, M3 và M6 vẫn phải được ghi nhận trước hành động phụ thuộc.

## 9. Quyết định bổ sung được duyệt — 2026-11-07

- Registry 5 tên miền văn bản ở mục 3.3 đã được người dùng duyệt. Mọi điều kiện robots/điều khoản vẫn áp dụng.
- Người dùng duyệt tạm dừng stack `hotelai` cũ để chạy demo riêng, giữ volume/database.
- Collector giá: sau chọn (b), người dùng chuyển sang **(a)** do chưa có nguồn/quyền thay thế. V1 dùng hợp đồng `stay-market-v1-no-competitors`, tắt nhóm giá đối thủ, công bố độ phủ không đủ ở admin/báo cáo; không điền giá giả/trung tính hoặc dùng model yêu cầu feature đã tắt. Đường tích hợp ứng dụng sẽ nghiệm thu tại M3/M4.
- **Thay hạn mức corpus riêng cho `danang.gov.vn`: tối đa 100 request/toàn đợt**, thay cho 50 tại bảng mục 3.3. Tổng tất cả nguồn vẫn ≤200; các tên miền khác vẫn tối đa 50; khoảng cách tối thiểu ≥5 giây hoặc giới hạn nghiêm hơn của nguồn. Không dùng alias để tăng ngân sách. Khảo sát giá vẫn ≤20/nguồn, không bị thay đổi bởi quyết định này.
- Cấu hình Qwen3 M0: model/digest hiện có, Q4_K_M, context 8192, tối đa 700 output tokens, 1 CPU thread, 1 worker, keep_alive=0; schema/prompt/runtime đã có manifest. Không đổi gate hoặc model.
- Người dùng duyệt thiết kế M2 tại `docs/HOTELAI_AI_V1_CONTEXT_DESIGN.md`: hoàn thiện schema/prompt/chuẩn hóa trên dev và đóng băng lại trước test. Runtime v2 đã đóng băng; không sử dụng vòng cải tiến sau thất bại gate vì chưa chấm test chính thức. Nhãn test/mẫu dev vẫn cần duyệt riêng. Thiết kế M3 và giả định nghiệp vụ demo mới được gửi, **chưa được coi là đã duyệt**.
