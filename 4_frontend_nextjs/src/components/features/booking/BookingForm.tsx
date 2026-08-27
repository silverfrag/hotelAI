'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createBooking } from '@/services/booking.service';
import { BookingResult, RoomType } from '@/types/room.type';

export function BookingForm({ roomTypes }: { roomTypes: RoomType[] }) {
  const { accessToken, isAuthenticated, ready } = useAuth();
  const [result, setResult] = useState<BookingResult>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setResult(undefined);

    if (!accessToken) {
      setError('Bạn cần đăng nhập trước khi đặt phòng.');
      return;
    }

    setLoading(true);
    const values = new FormData(event.currentTarget);
    const checkInDate = String(values.get('check_in_date') ?? '');
    const checkOutDate = String(values.get('check_out_date') ?? '');

    try {
      if (checkOutDate <= checkInDate) {
        throw new Error('Ngày trả phòng phải sau ngày nhận phòng.');
      }
      setResult(await createBooking({
        room_type_id: Number(values.get('room_type_id')),
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        total_of_special_requests: Number(values.get('requests')),
      }, accessToken));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Đã có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  }

  const totalPrice = result ? result.total_price ?? result.applied_price : 0;

  return (
    <form className="booking-form" onSubmit={submit}>
      <div>
        <h2>Đặt phòng với giá động</h2>
        {!ready && <p className="muted">Đang kiểm tra phiên đăng nhập...</p>}
        {ready && !isAuthenticated && (
          <p className="auth-notice">
            <Link href="/login">Đăng nhập</Link> hoặc <Link href="/register">đăng ký</Link> để đặt phòng.
          </p>
        )}
      </div>

      <label>
        Loại phòng
        <select name="room_type_id" required>
          {roomTypes.map((room) => (
            <option key={room.type_id} value={room.type_id}>{room.type_name}</option>
          ))}
        </select>
      </label>
      <label>
        Ngày nhận phòng
        <input name="check_in_date" type="date" required />
      </label>
      <label>
        Ngày trả phòng
        <input name="check_out_date" type="date" required />
      </label>
      <label>
        Yêu cầu đặc biệt
        <input name="requests" type="number" min="0" max="5" defaultValue="0" required />
      </label>
      <button disabled={loading || !ready || !isAuthenticated} type="submit">
        {loading ? 'Đang tính giá...' : 'Xác nhận đặt phòng'}
      </button>

      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <div className="success" role="status">
          <p>Đã giữ phòng {result.room_number}.</p>
          <p>
            Tổng tiền: {totalPrice.toLocaleString('vi-VN')} VND
            {result.nights ? ` cho ${result.nights} đêm` : ''} (AI ×{result.ai_multiplier}).
          </p>
          {result.nightly_price !== undefined && (
            <p className="price-breakdown">
              {result.nightly_price.toLocaleString('vi-VN')} VND/đêm
            </p>
          )}
        </div>
      )}
    </form>
  );
}
