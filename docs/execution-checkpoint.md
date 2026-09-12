# Backend, AI và vận hành — checkpoint

Cập nhật: 2026-09-06. Trạng thái: **OPS-001B/002A đã kiểm thử**, chưa release.

## Phạm vi đã được xác nhận

- Hoàn thiện backend, AI, database, kiểm thử và công cụ vận hành end-to-end.
- Không sửa UI, frontend hoặc `Source Figma Make` trong phiên này.
- Giữ AI champion phục vụ; promotion challenger vẫn cần dữ liệu thật và model gate.
- Không public/deploy hoặc gửi email/SMS thật từ môi trường phát triển.
- Không ghi đè dữ liệu người dùng; kiểm thử trên database riêng và dọn fixture.

## Mốc hoàn thành trước phiên

- OPS-001A: housekeeping và đổi phòng, migration 014, ledger/outbox, smoke HTTP/SQL.
- Backend/frontend build, 25 AI tests pass ở phiên trước.
- AI-004/005: code shadow pipeline đã có; chưa đủ dữ liệu thật để train/promote.

## Đang triển khai

Đã hoàn thành và kiểm thử trong phiên:

- Migration 015: Pending có TTL, policy snapshot bất biến, đủ cọc tự Confirmed,
  Expired/NoShow, credit authorization, lifecycle ledger và notification in-app.
- Đồng bộ tồn phòng, payment/refund, deactivation với công nợ, projections admin,
  booking replay, quote/training view. NoShow/Expired không thành completed stay;
  Completed lịch sử thiếu check-in/out thật bị censor.
- Endpoint PATCH /admin/bookings/:id/complete trả 410; không còn hoàn tất giả.
- Migration 016: group NOLOGIN hotelai_runtime, không DELETE booking/payment,
  không DDL/migration/ghi lại event payload. Login runtime riêng đã chạy API test.
- Migrator checksum/transaction/advisory lock; từ chối DB cũ chưa có migration
  ledger. Main compose đã dùng runner mới nhưng CHƯA chạy lên stack cũ.
- Sửa lỗi đóng gói test AI thiếu notebooks; 25/25 AI tests pass.
- Backend build pass; npm audit fix nâng qs và audit báo 0 vulnerabilities.
- 9 migration unit tests + 1 PostgreSQL integration test pass; 4 SQL domain suites
  pass, runtime-permissions SQL test pass riêng trên DB đã áp dụng 016.
- 11 HTTP suites pass với runtime DB login hạn chế quyền, trong DB
  hotel_validation_run_f5401020fcaa; workflow có 71 assertions/checks.
- AI outage suite pass riêng trên hotel_validation_run_aaece98686d4; đã bật lại AI.
- Restore drill 27 bảng khớp cả count và nội dung; report đầu tiên:
  .tmp/operations-evidence/8dd2c11c694d/restore-report.json.
  Đây chỉ là backup test, không chứng nhận backup production.

Đã chốt thêm:

- Production startup guard đã build thành image và smoke pass: cookie không
  secure bị từ chối; DB owner bị từ chối; restricted login được chấp nhận.
- CI backend-only job và runbook docs/backend-release-readiness.md đã bổ sung.
- Restore drill lần hai với migration016 + workflow fixtures pass 27 bảng:
  .tmp/operations-evidence/b8ad34fc5088/restore-report.json.

Không đánh đồng với hoàn thiện product 100%:

- AI champion vẫn hoạt động; conversion challenger chưa có artifact thật (503),
  chưa đủ real exposures/labels/time window để train/promote. Không dùng fixture
  kiểm thử làm dữ liệu thật, không tự hạ gate.
- Account email verification/recovery và transport giao dịch email/SMS chưa hoàn
  thiện; notification hiện chỉ in-app.
- Payment provider trực tuyến, reconciliation thực, domain/TLS, secret provisioning,
  backup mã hóa/offsite/retention và alert delivery chưa được chủ dự án cấu hình.
- DB cũ cần backup và xác minh prefix 001..014 để adopt ledger; tuyệt đối không
  tạo ledger rỗng rồi replay migration mù trên DB đang chạy.
- Phạm vi nghiệp vụ “100% product thực tế” chưa có acceptance checklist chủ dự án.

## Môi trường kiểm thử và cách chạy lại

- Dùng duy nhất compose file 1_infrastructure/operations/compose.test.yml, project
  hotelai-ops-validation; không restart default hotelai project.
- node 1_infrastructure/operations/run-validation.mjs: tạo DB scratch mới, migrate,
  dùng restricted app login, chạy backend-only suites. Không load .env.
- DB test được giữ lại làm bằng chứng; không xóa tự động. Không export chúng để train.
- node 1_infrastructure/operations/restore-drill.mjs <validation_database>: tạo
  archive local và DB restore mới, không ghi đè DB có sẵn.
- Frontend và docs/agent thuộc thread UI khác; không sửa/không reset.

## Bước tiếp theo cần lựa chọn sản phẩm

Account verification/recovery + email delivery; provider payment/webhook/
reconciliation; acceptance checklist nghiệp vụ; schema adoption DB cũ và
production hosting/secret/backup/alert configuration. Không suy diễn lựa chọn
nhà cung cấp hoặc gửi email/thanh toán thật. Đọc release-readiness trước khi làm.

## Tiếp tục nếu bị giới hạn

Đọc file này, `docs/ai-first-roadmap.md`, các migration mới và git diff trước khi
tiếp tục. Worktree có nhiều thay đổi từ các phiên trước; không reset hoặc ghi đè.
Chưa được tuyên bố production-ready trước khi kiểm thử hoàn tất và mọi blocker
release có bằng chứng xử lý. Bổ sung kết quả thực tế và bước kế tiếp tại đây.
