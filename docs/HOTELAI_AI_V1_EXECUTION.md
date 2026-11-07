# HotelAI AI v1 — nhật ký triển khai

Kế hoạch chuẩn: [HOTELAI_AI_V1_PLAN.md](HOTELAI_AI_V1_PLAN.md). Đọc lại đầu mỗi milestone. Nhánh: `feat/hotelai-ai-v1`. Run: `20261029-092250`.

## Trạng thái ngày 2026-11-07

- M0 đang bị chặn bởi Docker Desktop; chưa nghiệm thu. M1–M6 chưa bắt đầu.
- Đã lưu kế hoạch, tạo nhánh và kiểm kê trạng thái Git trước khi chỉnh sửa. Repo có nhiều thay đổi sẵn, bao gồm migration đã được đổi tên trước lần triển khai này; không gom vào commit AI v1.
- Bằng chứng lưu tại `artifacts/hotelai-ai-v1/20261029-092250/M0/`. Không commit raw patch hoặc dữ liệu máy; bàn giao riêng kèm manifest.
- Docker Desktop được khởi động từ bản cài hiện có, nhưng engine không lên. Log báo `initializing Ingest server` / `sailor-ingest.sock` / `The file cannot be accessed by the system`. Socket có timestamp 2026-10-29, nhưng chưa đủ bằng chứng để kết luận nguyên nhân duy nhất.
- Không thực hiện reset Docker, xóa socket, sửa ACL, thay WSL hoặc xóa volume. Các thao tác khôi phục ngoài repo cần chốt phạm vi với người dùng trước.
- RAM baseline mới được đo bằng preflight; chưa có số đo toàn stack, chưa đóng băng runtime Qwen3, chưa backup/restore và chưa đo p95.
- Các server academic cũ không được tính là ứng dụng thật để nghiệm thu booking.

## Chạy lại kiểm tra M0

Tại thư mục gốc repo:

```powershell
node .\1_infrastructure\operations\ai-v1-preflight.mjs 20261029-092250
```

Lệnh chỉ đọc trạng thái, không khởi động/cài dịch vụ và không nạp `.env`. Mỗi lần chạy tạo thư mục bằng chứng riêng, report và SHA-256 manifest. Exit code 2 nghĩa là Docker chưa sẵn sàng. Đây là công cụ preflight; launcher `start/stop/status` toàn stack vẫn chưa hoàn thành.

## Các điểm duyệt còn mở

- Khôi phục Docker nếu cần thay đổi trạng thái bên ngoài repo.
- Registry văn bản: `danangfantasticity.com`, `startupdanang.vn`, `danang.gov.vn`, `cttdt.danangportal.gov.vn`, `baodanang.vn`; cần xác nhận riêng trước thu corpus theo plan.
- Gói nhãn test/dev; chỉ có sau khi được phép thu nguồn và M0 hoàn thành.
- Thiết kế booking/migration trước sửa tại M3.
- Gói nghiệm thu trước khóa tại M6.

Không xem các mục này là đã duyệt bằng việc tiếp tục chạy preflight.
