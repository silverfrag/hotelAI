# Chạy stack demo AI v1

Chạy trong PowerShell tại `E:\hotelAI`. Dùng Node, Python venv, Ollama/Qwen3 và ba Docker image đã có; launcher không cài dependency hoặc tải model. DB demo tách biệt với stack `hotelai` cũ.

```powershell
# Sau thay đổi mã ứng dụng: build tuần tự, rồi khởi động.
.\1_infrastructure\operations\ai-v1-local.ps1 build
.\1_infrastructure\operations\ai-v1-local.ps1 start
.\1_infrastructure\operations\ai-v1-local.ps1 status
.\1_infrastructure\operations\ai-v1-local.ps1 backup
.\1_infrastructure\operations\ai-v1-local.ps1 stop
```

`start` dùng production artifacts đã build, áp dụng migration hiện có vào DB demo và chạy stack bằng một lệnh. `infra` chỉ chạy PostgreSQL/Redis/Kafka để đo tài nguyên theo giai đoạn. `stop` xác thực PID, thời điểm tạo và executable trước khi dừng cây tiến trình do launcher tạo; chỉ stop Compose demo, không xóa volume. Lỗi trong startup giữ lại log/trạng thái để kiểm tra; chạy `stop` để dừng phần đã khởi động.

| Thành phần | Địa chỉ local |
|---|---|
| Website production | `http://127.0.0.1:53224` |
| NestJS thật | `http://127.0.0.1:53223/api/v1/core` |
| FastAPI đầy đủ | `http://127.0.0.1:58220` |
| Ollama riêng cho demo | `http://127.0.0.1:11435` |
| PostgreSQL / Redis / Kafka | `55321` / `56321` / `59321` |

Secrets demo sinh tại `.tmp/ai-v1-local/secrets.json`, không dùng `.env` gốc cho Compose. Giữ file này để truy cập lại volume demo; không đưa vào Git/bằng chứng. Launcher cấp biến môi trường DB riêng cho NestJS và migration runner; NestJS/Next.js vẫn giữ cơ chế đọc cấu hình phụ của ứng dụng. Không dùng credentials hoặc URL vận hành cho demo.

Log, PID, mẫu RAM, backup và restore report ở `.tmp/ai-v1-local/`. `backup` tạo DB restore mới, không ghi đè DB có sẵn; kiểm tra hash nội dung từng bảng và constraint trên nguồn demo không có thao tác khách trong lúc đối chiếu. Bản dump có dữ liệu demo nên không commit. Bằng chứng nghiệm thu được sao chép vào thư mục artifact theo plan, kèm SHA-256 manifest.

Giới hạn Compose cưỡng chế: PostgreSQL 384 MiB, Redis 96 MiB (maxmemory 48 MiB), Kafka 640 MiB với heap 256 MiB. Các tiến trình native được giám sát RAM; chưa có giới hạn RAM cưỡng chế bằng Windows Job Object. Ngưỡng 1,5 GiB được kiểm tra tại các bước startup; điều này không thay cho đo liên tục khi suy luận hoặc gate p95.

FastAPI chạy `app.main:app`, NestJS chạy `dist/main.js`, Next.js chạy production build. Không dùng academic server thay thế. Artifact giá/conversion vận hành cố ý chưa được nạp: liveness FastAPI có thể healthy trong khi `/health` báo model unavailable. Trạng thái này không chứng minh pricing sẵn sàng. Tính đúng nguồn fallback, context và booking sẽ được nghiệm thu tại các milestone tiếp theo sau điểm duyệt M3.

Smoke ban đầu context 4096/output 32 chỉ kiểm tra hạ tầng. M0 sau đó đóng băng extraction v1; người dùng đã duyệt cập nhật M2 trên dev và đóng băng lại v2. Bản hiện tại context 8192, output 700, một CPU thread/worker, keep_alive=0, cùng digest Qwen3/Q4_K_M. Manifest tại `artifacts/hotelai-ai-v1/20261029-092250/M2/runtime-freeze-v2/`; `status` kiểm hash mọi source file trong manifest mới nhất, không chỉ đọc cờ frozen. RAM tối thiểu 2,7674 GiB trong probe adapter v2 cùng toàn stack, 5 health qua; chưa nghiệm thu precision/recall hay p95.

Launcher tắt collector preview cũ (`MARKET_LEGACY_COLLECTION_DISABLED=1`) để không thu ngoài registry/budget. Việc thu corpus chỉ qua script có ledger. Job context lưu JSON có version/hash tại `.tmp/ai-v1-local/context-jobs`, không lưu pickle/secret; đọc cache không gia hạn TTL. Chưa có refresh vận hành đầy đủ được nghiệm thu. Giá đối thủ đã tắt theo nhánh (a) người dùng duyệt; Qwen và conversion vẫn chưa đạt nghiệm thu vận hành.

Sau khi dừng demo, stack cũ có thể được mở lại bằng `docker start` với các container đã ghi trong `artifacts/hotelai-ai-v1/20261029-092250/M0/old-stack-stop.json`. Không chạy song song khi RAM chưa đủ. Launcher không tự khởi động stack cũ.
