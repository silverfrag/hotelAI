# OPS-001A — Housekeeping và đổi phòng

## Trạng thái

Phần backend, database, contract frontend và kiểm thử end-to-end đã hoàn tất.
Frontend hiện chỉ có type/service contract; chưa thêm màn hình hoặc thay đổi thiết
kế UI.

## Luồng trạng thái housekeeping

```text
Checkout / chuyển khách khỏi phòng
              │
              v
Ready ──────> Dirty ──────> Cleaning ──────> Ready
                              │
                              └────────────> Dirty  (kiểm tra không đạt)
```

- Phòng `Occupied` luôn phải có housekeeping `Ready`.
- Check-in và chuyển khách đang lưu trú chỉ nhận phòng `Available + Ready`.
- Checkout giải phóng occupancy nhưng chuyển phòng thành `Available + Dirty`.
- Phòng `Dirty` hoặc `Cleaning` không được bán cho ngày nhận phòng hiện tại.
- Với booking tương lai, phòng chưa Ready vẫn có thể được phân nếu không bảo trì
  và không trùng lịch; phòng phải Ready trước lúc check-in.
- Snapshot AI vẫn tính mọi phòng không `Maintenance` vào `rooms_sellable`;
  điều kiện `Available + Ready` chỉ làm giảm `rooms_available` cho ngày nhận
  phòng hiện tại. Nhờ đó phòng `Occupied`, `Dirty` hoặc `Cleaning` không biến
  mất khỏi mẫu số occupancy và invariant hiện tại
  `rooms_available + rooms_booked = rooms_sellable` được giữ nguyên.

Mỗi transition tăng `housekeeping_version` đúng một lần. `expected_version` ngăn
hai nhân viên ghi đè nhau; request thua trả `409 Conflict`.

## API admin

Tất cả endpoint yêu cầu role `admin`.

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| `GET` | `/api/v1/core/admin/housekeeping` | Hàng đợi có lọc `status`, `limit`, `offset` |
| `PATCH` | `/api/v1/core/admin/rooms/:roomId/housekeeping` | Chuyển trạng thái housekeeping |
| `POST` | `/api/v1/core/admin/bookings/:bookingId/reassign-room` | Đổi phòng vật lý cùng loại |

Hai mutation bắt buộc `Idempotency-Key` dài 8–100 ký tự. Body housekeeping:

```json
{
  "target_status": "Cleaning",
  "expected_version": 2,
  "reason": "Housekeeper started cleaning room 101"
}
```

Body đổi phòng:

```json
{
  "target_room_id": 102,
  "expected_assignment_version": 1,
  "reason": "Guest requested another room of the same type"
}
```

Retry cùng key và cùng payload trả lại event gốc. Tái sử dụng key với payload
khác, version cũ, transition sai, phòng bảo trì, khác loại, trùng lịch hoặc chưa
Ready cho khách đang ở đều trả `409`.

## Toàn vẹn dữ liệu

Migration `014_room_turnover_integrity.sql` tạo hai ledger append-only:

- `room_housekeeping_events`;
- `booking_room_assignment_events`.

Application chèn event trước rồi mới cập nhật aggregate trong cùng transaction.
Constraint trigger deferred kiểm tra hai chiều: event không có mutation và mutation
không có event đều không thể commit. Timestamp audit do PostgreSQL cấp. Đổi phòng
giữ nguyên `applied_price`, room-type snapshot, quote ID, model version, training
run và feature-contract version.

Nếu booking đang `CheckedIn`, một transaction duy nhất sẽ:

1. đổi `booking_details.room_id` và tăng assignment version;
2. trả phòng nguồn về `Available + Dirty` và ghi housekeeping event;
3. nhận phòng đích thành `Occupied + Ready`;
4. ghi `booking.room-reassigned.v1` và
   `room.housekeeping-status-changed.v1` vào transactional outbox.

Contract hiện giới hạn một transition trên mỗi aggregate trong một transaction.
Các API đã tuân thủ giới hạn này.

## Kiểm thử

```powershell
Set-Location 3_backend_core
npm run build
npm run test:room-turnover-smoke

psql -v ON_ERROR_STOP=1 -f `
  ..\1_infrastructure\postgres\tests\room_turnover_integrity_smoke.sql
```

Smoke runtime bao phủ RBAC, checkout-to-Dirty, transition/retry/version, inventory
ngày hiện tại và tương lai, target sai, race hai reassignment, bảo toàn AI lineage,
đổi phòng khách đang ở, outbox và append-only ledger.

## Phạm vi tiếp theo

`OPS-001B` còn lại: booking pending/expiry, chính sách đặt cọc/công nợ, no-show
đầy đủ và notification. AI-004/005 vẫn ở trạng thái pause theo promotion gate;
OPS-001A không tự bật shadow hoặc thay giá đang phục vụ.
