# HotelAI AI v1 — nhật ký triển khai

Kế hoạch chuẩn: [HOTELAI_AI_V1_PLAN.md](HOTELAI_AI_V1_PLAN.md). Đọc lại đầu mỗi milestone. Nhánh: `feat/hotelai-ai-v1`. Run: `20261029-092250`.

## Trạng thái ngày 2026-11-07

- M0 đã hoàn thành kiểm tra hạ tầng và đóng băng runtime Qwen3 ngày 2026-11-07; bắt đầu M1. Gate chất lượng Qwen3, conversion và p95 vẫn chưa được nghiệm thu.
- Đã lưu kế hoạch, tạo nhánh và kiểm kê trạng thái Git trước khi chỉnh sửa. Repo có nhiều thay đổi sẵn, bao gồm migration đã được đổi tên trước lần triển khai này; không gom vào commit AI v1.
- Bằng chứng lưu tại `artifacts/hotelai-ai-v1/20261029-092250/M0/`. Không commit raw patch hoặc dữ liệu máy; bàn giao riêng kèm manifest.
- Docker Desktop được khởi động từ bản cài hiện có, nhưng engine không lên. Log báo `initializing Ingest server` / `sailor-ingest.sock` / `The file cannot be accessed by the system`. Socket có timestamp 2026-10-29, nhưng chưa đủ bằng chứng để kết luận nguyên nhân duy nhất.
- Người dùng đã duyệt dừng Docker Desktop, chuyển socket lỗi sang bản lưu và khởi động lại ngày 2026-11-07. Đã dừng riêng các tiến trình Docker Desktop/backend. `Move-Item`, `Rename-Item` và native `MoveFileExW` đều thất bại; native trả Win32 1920 (`The file cannot be accessed by the system`). `fsutil reparsepoint query` cũng trả lỗi 1920. Chưa đổi tên được socket, chưa tạo bản lưu và chưa khởi động lại Docker sau các lần thất bại. Dừng nhánh khôi phục tại đây; không thực hiện reset Docker, xóa socket, sửa ACL, thay WSL hoặc xóa volume.
- Người dùng duyệt tạm dừng các container stack `hotelai` cũ; đã dừng, giữ volume. Stack `hotelai-ai-v1-demo` dùng PostgreSQL/Redis/Kafka riêng và ứng dụng native production thật. Build Nest/Next qua; 18 migration hiện có áp dụng vào DB demo mới; không chỉnh SQL/booking.
- Đã chạy một lệnh start, kiểm tra 5 health (kể cả Next proxy → Nest), stop/start lại thành công. Backup/restore khớp 27 bảng và constraint, báo cáo `.tmp/ai-v1-local/hotelai_ai_v1_restore_20261107081800.report.json`.
- Resource smoke Qwen3 thành công trong khoảng 5,13 giây nhưng RAM khả dụng xuống 1,2188 GiB, không đạt 1,5 GiB. Cấu hình thử: context 4096, num_thread=1, num_predict=32, keep_alive=0, Kafka heap 256 MiB. Giữ nguyên kết quả thất bại; chưa đóng băng runtime extraction và chưa đo p95. Người dùng đang được đề nghị giải phóng RAM để đo lại.
- Đo lại sau khi người dùng giải phóng RAM: baseline khoảng 5,13 GiB; tối thiểu 3,2804 GiB khi Qwen3 chạy cùng stack, đạt ngưỡng 1,5 GiB. Bài thử hạ tầng dùng văn bản fixture có nhãn, context 4096, num_thread=1, num_predict=700, keep_alive=0; 137 mẫu RAM cách nhau khoảng 250 ms, request hoàn tất khoảng 35,46 giây kể cả health check sau thử. 5/5 health check sau thử qua. Bằng chứng: `M0/ram-retest-2026-11-07T01-30-35-012Z/`. Không coi đây là đánh giá chất lượng Qwen3 hoặc gate p95; cấu hình extraction thực tế còn phải đồng bộ và đóng băng.
- Các server academic cũ không được tính là ứng dụng thật để nghiệm thu booking.
- Hoàn tất đồng bộ adapter thật: context 8192 (giữ cỡ context cũ, trong khoảng cho phép), output tối đa 700, 1 luồng CPU, keep_alive=0, một worker. Từ chối đầu vào vượt ngân sách bảo thủ thay vì cắt ngầm. 19 test runtime/adapter qua. Khởi động lại stack bằng launcher đã cập nhật, kiểm tra digest model thành công. Probe qua đúng `complete_local` với fixture có nhãn: RAM thấp nhất 2,8174 GiB, CPU hệ thống đỉnh 95,73%, 5/5 health sau thử qua. Đây là phép đo hạ tầng, không phải thực nghiệm precision/recall hoặc p95.
- Manifest đóng băng tại `M0/runtime-freeze-v1/runtime.json`, gồm digest Qwen3/Q4_K_M, config, hash schema, prompt/transport, worker và mã nguồn. Thay đổi ảnh hưởng suy luận sau mốc này phải được duyệt/đánh giá lại. Kết quả RAM cũ không đạt vẫn được giữ trong evidence.
- M1 khảo sát 4 khách sạn với 8 request; chưa có nguồn giá hợp lệ. Bộ nhận diện chuỗi captcha ban đầu có false positive; đã sửa và ghi lại đánh giá chưa xác minh, không khẳng định có 403/CAPTCHA chặn. Người dùng chọn (b), đang chờ nguồn/quyền cụ thể; không được khóa v1 hoặc tự tắt feature.
- Thêm hợp đồng coverage đa đêm độc lập và kiểm thử các trường hợp thiếu/cũ/replay/LLM chưa được duyệt/quote đối thủ chỉ bao phủ một phần. 33 test runtime, contract và khảo sát khách sạn qua. Chưa nối vào quote/booking; M3 vẫn giữ điểm duyệt trước sửa code.
- M2 chuẩn bị nguồn văn bản độc lập với giá đối thủ: 12 request rà soát 5 tên miền. `danang.gov.vn` có điều kiện dẫn nguồn khi sử dụng lại; các nguồn khác còn hạn chế/chưa rõ. Chưa thu corpus hoặc chấm test Qwen3. Đang xin duyệt nâng riêng hạn mức danang.gov.vn lên 100 trong tổng 200, chưa tự thay hạn mức. Chi tiết tại [HOTELAI_AI_V1_SOURCE_REVIEW.md](HOTELAI_AI_V1_SOURCE_REVIEW.md).

## Chạy lại kiểm tra M0

Tại thư mục gốc repo:

```powershell
node .\1_infrastructure\operations\ai-v1-preflight.mjs 20261029-092250
```

Lệnh preflight chỉ đọc trạng thái, không khởi động/cài dịch vụ và không nạp `.env`. Mỗi lần chạy tạo thư mục bằng chứng riêng, report và SHA-256 manifest. Exit code 2 nghĩa là Docker chưa sẵn sàng. Preflight cũ thăm dò Ollama 11434; demo mới dùng 11435, kiểm tra qua launcher `status`. Hướng dẫn launcher tại [HOTELAI_AI_V1_LOCAL.md](HOTELAI_AI_V1_LOCAL.md).

## Các điểm duyệt còn mở

- M1: người dùng đã chuyển từ (b) sang **(a)**; contract tắt giá đối thủ có version riêng. Không còn chờ URL; không được tuyên bố đã có giá đối thủ thật. Tích hợp hiển thị trạng thái ở admin/báo cáo còn thuộc M3.
- M2: hạn mức danang.gov.vn 100 đã được duyệt; đã thu 80 văn bản thật, tổng ledger 100 request trên 5 tên miền. 30 dev nháp +30 test nháp, 20 dự phòng. Gói 30 test +10 dev đã gửi, chờ duyệt nhãn. Test dương mới có một cụm: hạn chế lớn phải công bố.
- Registry văn bản **đã được người dùng duyệt trong chat ngày 2026-11-07**: `danangfantasticity.com`, `startupdanang.vn`, `danang.gov.vn`, `cttdt.danangportal.gov.vn`, `baodanang.vn`. Chỉ bắt đầu thu sau M0, kiểm tra robots/điều khoản và hạn mức; không tự mở rộng qua redirect.
- Gói nhãn test/dev tại `M2/label-review/index.html`; user_approved vẫn false, chưa chấm gate chính thức. Gói sớm giữ nguyên hash khi hoàn thành thêm 20 dev ở file riêng.
- Thiết kế booking/migration trước sửa tại M3: đã soạn `docs/HOTELAI_AI_V1_M3_DESIGN.md` và gửi xin duyệt, gồm giả định nghiệp vụ demo cần chốt; **chưa sửa booking/migration**.
- Gói nghiệm thu trước khóa tại M6.

Không xem các mục này là đã duyệt bằng việc tiếp tục chạy preflight.

## Cập nhật M2 sau phê duyệt ngày 2026-11-07

- Người dùng duyệt “Duyệt thiết kế M2, làm trên dev rồi đóng băng lại”. Giữ model/digest/quantization/tài nguyên/gate; hoàn thiện schema/date/type trên dev, không dùng test chỉnh prompt.
- Hai lượt probe 3 dev +5 fixture injection/lượt được lưu riêng. Prompt đầu không giữ được thông tin dương; sau điều chỉnh lấy đúng lễ hội năm mới nhưng vẫn bỏ sót Pickleball/thông tin thành phần. 5/5 injection trả rỗng ở lượt cuối. Không biến kết quả dev hoặc fixture thành metric test.
- Runtime v2 đã đóng băng tại `M2/runtime-freeze-v2/runtime.json`; giữ freeze v1 M0. Probe thực tế cùng stack: RAM min 2,7674 GiB, 5 health qua, chưa có p95 hay gate chất lượng. Launcher status xác nhận hash runtime v2 khớp.
- 90 tests M1/M2/runtime/contract qua; 12 tests optimizer fixture độc lập và 4 tests tính metric/CI một–một qua. Optimizer chưa nối booking; evaluator chưa chấm test thật. Có 9 cảnh báo deprecation dependency ở nhóm test cũ; không cài dependency ngoài plan để xử lý.
- Lượt kiểm tra kết hợp cuối: **106 tests qua**, JUnit tại `M2/tests-20261107.xml`. Lab HTML/JSON dùng đường xác suất viết tay có nhãn tại `M2/independent-optimizer-lab/`; không phát hành quote, không ghi dữ liệu học và không chứng minh accuracy thị trường.
- Checkpoint context bền vững và cache không tự gia hạn đã có test. Collector preview cũ bị tắt để không vượt registry/budget. Refresh vận hành và admin/readiness/exporter chưa nghiệm thu.
- Các dòng khảo sát (b)/ngân sách 50/chưa thu corpus ở phần lịch sử phía trên phản ánh thời điểm cũ; trạng thái hiện tại theo mục “Các điểm duyệt còn mở” và cập nhật này.
