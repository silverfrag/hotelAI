# HotelAI AI v1 — nhật ký triển khai

Kế hoạch chuẩn: [HOTELAI_AI_V1_PLAN.md](HOTELAI_AI_V1_PLAN.md). Đọc lại đầu mỗi milestone. Nhánh: `feat/hotelai-ai-v1`. Run: `20261029-092250`.

## Trạng thái ngày 2026-11-07

- Docker engine đã khôi phục sau người dùng mở lại. M0 đang bị chặn bởi gate RAM dưới tải Qwen3; chưa nghiệm thu. M1–M6 chưa bắt đầu.
- Đã lưu kế hoạch, tạo nhánh và kiểm kê trạng thái Git trước khi chỉnh sửa. Repo có nhiều thay đổi sẵn, bao gồm migration đã được đổi tên trước lần triển khai này; không gom vào commit AI v1.
- Bằng chứng lưu tại `artifacts/hotelai-ai-v1/20261029-092250/M0/`. Không commit raw patch hoặc dữ liệu máy; bàn giao riêng kèm manifest.
- Docker Desktop được khởi động từ bản cài hiện có, nhưng engine không lên. Log báo `initializing Ingest server` / `sailor-ingest.sock` / `The file cannot be accessed by the system`. Socket có timestamp 2026-10-29, nhưng chưa đủ bằng chứng để kết luận nguyên nhân duy nhất.
- Người dùng đã duyệt dừng Docker Desktop, chuyển socket lỗi sang bản lưu và khởi động lại ngày 2026-11-07. Đã dừng riêng các tiến trình Docker Desktop/backend. `Move-Item`, `Rename-Item` và native `MoveFileExW` đều thất bại; native trả Win32 1920 (`The file cannot be accessed by the system`). `fsutil reparsepoint query` cũng trả lỗi 1920. Chưa đổi tên được socket, chưa tạo bản lưu và chưa khởi động lại Docker sau các lần thất bại. Dừng nhánh khôi phục tại đây; không thực hiện reset Docker, xóa socket, sửa ACL, thay WSL hoặc xóa volume.
- Người dùng duyệt tạm dừng các container stack `hotelai` cũ; đã dừng, giữ volume. Stack `hotelai-ai-v1-demo` dùng PostgreSQL/Redis/Kafka riêng và ứng dụng native production thật. Build Nest/Next qua; 18 migration hiện có áp dụng vào DB demo mới; không chỉnh SQL/booking.
- Đã chạy một lệnh start, kiểm tra 5 health (kể cả Next proxy → Nest), stop/start lại thành công. Backup/restore khớp 27 bảng và constraint, báo cáo `.tmp/ai-v1-local/hotelai_ai_v1_restore_20261107081800.report.json`.
- Resource smoke Qwen3 thành công trong khoảng 5,13 giây nhưng RAM khả dụng xuống 1,2188 GiB, không đạt 1,5 GiB. Cấu hình thử: context 4096, num_thread=1, num_predict=32, keep_alive=0, Kafka heap 256 MiB. Giữ nguyên kết quả thất bại; chưa đóng băng runtime extraction và chưa đo p95. Người dùng đang được đề nghị giải phóng RAM để đo lại.
- Các server academic cũ không được tính là ứng dụng thật để nghiệm thu booking.

## Chạy lại kiểm tra M0

Tại thư mục gốc repo:

```powershell
node .\1_infrastructure\operations\ai-v1-preflight.mjs 20261029-092250
```

Lệnh preflight chỉ đọc trạng thái, không khởi động/cài dịch vụ và không nạp `.env`. Mỗi lần chạy tạo thư mục bằng chứng riêng, report và SHA-256 manifest. Exit code 2 nghĩa là Docker chưa sẵn sàng. Preflight cũ thăm dò Ollama 11434; demo mới dùng 11435, kiểm tra qua launcher `status`. Hướng dẫn launcher tại [HOTELAI_AI_V1_LOCAL.md](HOTELAI_AI_V1_LOCAL.md).

## Các điểm duyệt còn mở

- Gate RAM 1,5 GiB trong lúc Qwen3 suy luận: chưa đạt, cần giải phóng RAM và đo lại; không đổi model, bỏ Kafka hoặc nới gate.
- Registry văn bản **đã được người dùng duyệt trong chat ngày 2026-11-07**: `danangfantasticity.com`, `startupdanang.vn`, `danang.gov.vn`, `cttdt.danangportal.gov.vn`, `baodanang.vn`. Chỉ bắt đầu thu sau M0, kiểm tra robots/điều khoản và hạn mức; không tự mở rộng qua redirect.
- Gói nhãn test/dev; chỉ có sau khi được phép thu nguồn và M0 hoàn thành.
- Thiết kế booking/migration trước sửa tại M3.
- Gói nghiệm thu trước khóa tại M6.

Không xem các mục này là đã duyệt bằng việc tiếp tục chạy preflight.
