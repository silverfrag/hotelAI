# Goal Tracker: End-to-End Hotel AI Platform Evolution (Phases 1 - 5)

Tài liệu này đóng vai trò là kim chỉ nam và bộ lưu vết trạng thái (Checkpoints) để bất kỳ agent nào khi tiếp tục phiên làm việc đều nắm bắt chính xác tiến trình, các mục tiêu đã hoàn thành và việc cần làm tiếp theo.

---

## Bảng Tổng Quan Lộ Trình (Roadmap Status)

| Giai đoạn | Tên Module / Tính năng | Trạng thái | Checkpoint bàn giao / Ghi chú |
| :--- | :--- | :--- | :--- |
| **Base Release** | 98 Rooms + Smart Allocation + Upgrade Engine + Housekeeping | **HOÀN THÀNH** | Đã commit `fdbc557`, push GitHub. 100% Smoke Tests pass. |
| **Phase 1** | **Visual Tape Chart & Front-Desk Room Rack Grid** | **HOÀN THÀNH** | API `/admin/tape-chart`, UI `/admin/tape-chart`, 98 phòng Gantt, check-in, check-out, đổi phòng, đổi trạng thái buồng phòng. Build & Smoke pass 100%. |
| **Phase 2** | **Dynamic Availability Calendar & Multi-Room Booking** | **TIẾP THEO (QUEUED)** | Bảng lịch chọn ngày có giá theo đêm, hỗ trợ đặt nhiều phòng một lúc. |
| **Phase 3** | **Guest 360 & Loyalty Tiering Engine (Aurum Club)** | Chưa bắt đầu | Hồ sơ khách hàng, phân hạng VIP, tự động kích hoạt AI Upgrade cho khách thân thiết. |
| **Phase 4** | **In-Stay Web Concierge & AI Chatbot Trợ Lý Số** | Chưa bắt đầu | Cổng thông tin cho khách đang lưu trú: gọi món, yêu cầu dọn phòng, AI chat 24/7. |
| **Phase 5** | **Executive Analytics & RevPAR / Demand Forecasting BI** | Chưa bắt đầu | Dashboard phân tích chỉ số kinh doanh OCC, ADR, RevPAR và dự báo tương lai. |

---

## Chi Tiết Từng Giai Đoạn & Tiêu Chí Nghiệm Thu (Acceptance Criteria)

### Phase 1: Visual Tape Chart & Front-Desk Room Rack Grid
- [x] **Backend API**:
  - `GET /api/v1/core/admin/tape-chart`: Trả về dữ liệu ma trận 98 phòng x N ngày (mặc định 14 ngày), gồm thông tin phòng, trạng thái buồng phòng, thông tin booking đang chiếm phòng hoặc sắp đến.
  - Tích hợp các thao tác: Nhận phòng (`check-in`), Trả phòng (`check-out`), Đổi phòng (`reassign-room`), Đổi trạng thái vệ sinh (`housekeeping`).
- [x] **Frontend UI**:
  - Trang `/admin/tape-chart` trên Next.js App Router (21/21 static/dynamic routes compiled).
  - Ma trận Gantt Chart:
    - Cột cố định bên trái (Sticky): Số phòng (98 phòng), Hạng phòng, Tầng, Huy hiệu trạng thái buồng phòng tương tác 1-chạm (`Dirty` -> `Cleaning` -> `Ready`).
    - Hàng cố định bên trên (Sticky): Dải ngày với thứ trong tuần, đánh dấu nổi bật "Hôm nay".
    - Các khối booking trải dài theo dải ngày lưu trú với màu sắc phân biệt trực quan (`Confirmed` xanh dương, `CheckedIn` xanh ngọc, `Completed` xám).
  - Thanh công cụ điều hướng ngày: Hôm nay, < Tuần trước, Tuần sau >, Bộ chọn ngày nhanh, Lọc theo Hạng phòng, Tầng 1–8, Trạng thái buồng phòng, Tìm kiếm số phòng/khách.
  - Modal chi tiết booking khi nhấp vào: Xem chi tiết khách, trạng thái, nút Check-in / Check-out / Đổi phòng trực tiếp.
- [x] **Đồng bộ Navigation & Translations**:
  - Thêm vào [adminNav.ts](file:///e:/hotelAI/4_frontend_nextjs/src/components/layout/adminNav.ts) với icon `CalendarDays` và huy hiệu `Live`.
  - Hỗ trợ đầy đủ theme sang trọng dark/light.


---

### Phase 2: Dynamic Availability Calendar & Multi-Room Booking
- [ ] Nâng cấp trang `/book` và `/rooms` với bộ chọn dải ngày trực quan hiển thị giá dao động từng đêm.
- [ ] Hỗ trợ thêm nhiều phòng vào 1 giỏ đặt (Group Booking): Phân bổ phòng liền kề cho gia đình/đoàn.
- [ ] Gợi ý dịch vụ đi kèm (Ancillary Services) cá nhân hóa theo loại phòng.

---

### Phase 3: Guest 360 & Loyalty Tiering Engine (Aurum Club)
- [ ] Bảng dữ liệu và logic tích lũy chi tiêu/số đêm cho tài khoản khách hàng.
- [ ] Phân hạng tự động: Silver, Gold, Platinum, Diamond.
- [ ] Tích hợp tự động đưa khách VIP vào danh sách ưu tiên nâng hạng của `Smart Upgrade Engine`.
- [ ] Quản lý hồ sơ sở thích khách hàng (Guest Preferences) cho lễ tân.

---

### Phase 4: In-Stay Web Concierge & AI Chatbot Trợ Lý Số
- [ ] Trang `/in-stay` hoặc `/concierge` dành riêng cho khách đang trong trạng thái `CheckedIn`.
- [ ] Gọi món ăn về phòng (In-Room Dining Menu) & Yêu cầu tiện ích (thêm khăn, dọn phòng).
- [ ] Tích hợp AI Concierge Chatbot giải đáp thông tin resort thời gian thực.
- [ ] Express Check-out trực tuyến xem chi tiết hóa đơn dịch vụ.

---

### Phase 5: Executive Analytics & RevPAR / Demand Forecasting BI
- [ ] Dashboard dành cho Ban Giám đốc: Biểu đồ OCC, ADR, RevPAR theo thời gian thực.
- [ ] Mô hình dự báo nhu cầu lưu trú trong 30–90 ngày tới (Pace Curve).
- [ ] Đề xuất và điều chỉnh giá tự động theo tuần với cơ chế phê duyệt 1-chạm của Revenue Manager.

---

## Hướng Dẫn Dành Cho Agent Phiên Tiếp Theo
1. **Đọc file này trước tiên**: Kiểm tra cột `Trạng thái` trong bảng tổng quan.
2. **Kiểm tra git status & logs**: Xem commit gần nhất và file đang dở dang.
3. **Chạy kiểm thử khói trước khi code**:
   `cd 3_backend_core && npm run test:public-journey-smoke`
4. **Tiếp tục phase hiện tại hoặc chuyển sang phase tiếp theo**: Cập nhật file này ngay sau khi hoàn thành một checkpoint.
