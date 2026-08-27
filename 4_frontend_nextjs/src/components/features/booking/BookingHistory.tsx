'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useBookingHistory } from '@/hooks/useBookingHistory';
import { BookingSummary } from '@/types/booking.type';
import { formatCurrency } from '@/utils/formatCurrency';

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatHotelDate(value: string): string {
  const dateOnly = value.slice(0, 10);
  const parsed = new Date(`${dateOnly}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function formatCreatedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateTimeFormatter.format(parsed);
}

function statusDetails(status: string): { label: string; className: string } {
  switch (status.toLowerCase()) {
    case 'confirmed':
      return { label: 'Đã xác nhận', className: 'status-confirmed' };
    case 'cancelled':
    case 'canceled':
      return { label: 'Đã hủy', className: 'status-cancelled' };
    case 'checked-in':
    case 'checked_in':
      return { label: 'Đã nhận phòng', className: 'status-active' };
    case 'checked-out':
    case 'checked_out':
    case 'completed':
      return { label: 'Đã hoàn thành', className: 'status-completed' };
    default:
      return { label: status, className: 'status-default' };
  }
}

function hotelToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function canCancel(booking: BookingSummary): boolean {
  return booking.status.toLowerCase() === 'confirmed'
    && booking.check_in_date.slice(0, 10) > hotelToday();
}

interface BookingCardProps {
  booking: BookingSummary;
  cancelling: boolean;
  actionDisabled: boolean;
  onCancel: (booking: BookingSummary) => void;
}

function BookingCard({ booking, cancelling, actionDisabled, onCancel }: BookingCardProps) {
  const status = statusDetails(booking.status);

  return (
    <article className="booking-history-card">
      <header className="booking-card-header">
        <div>
          <p className="booking-reference">Mã đặt phòng #{booking.booking_id.slice(0, 8).toUpperCase()}</p>
          <h2>{booking.room_type}</h2>
          <p className="muted">Phòng {booking.room_number}</p>
        </div>
        <span className={`booking-status ${status.className}`}>{status.label}</span>
      </header>

      <dl className="booking-details">
        <div>
          <dt>Nhận phòng</dt>
          <dd>{formatHotelDate(booking.check_in_date)}</dd>
        </div>
        <div>
          <dt>Trả phòng</dt>
          <dd>{formatHotelDate(booking.check_out_date)}</dd>
        </div>
        <div>
          <dt>Thời gian lưu trú</dt>
          <dd>{booking.nights} đêm</dd>
        </div>
        <div>
          <dt>Giá mỗi đêm</dt>
          <dd>{formatCurrency(booking.nightly_price)}</dd>
        </div>
      </dl>

      <footer className="booking-card-footer">
        <div>
          <span className="muted">Tổng thanh toán</span>
          <strong>{formatCurrency(booking.total_price)}</strong>
          <small>Đặt lúc {formatCreatedAt(booking.created_at)}</small>
        </div>
        {canCancel(booking) && (
          <button
            className="cancel-booking-button"
            disabled={actionDisabled}
            onClick={() => onCancel(booking)}
            type="button"
          >
            {cancelling ? 'Đang hủy...' : 'Hủy đặt phòng'}
          </button>
        )}
      </footer>
    </article>
  );
}

export function BookingHistory() {
  const { accessToken, isAuthenticated, ready, logout } = useAuth();
  const {
    bookings,
    loading,
    error,
    actionMessage,
    cancellingId,
    reload,
    cancel,
  } = useBookingHistory({
    accessToken,
    enabled: ready && isAuthenticated,
    onUnauthorized: logout,
  });

  async function confirmCancellation(booking: BookingSummary) {
    const confirmed = window.confirm(
      `Bạn có chắc muốn hủy phòng ${booking.room_number} từ ${formatHotelDate(booking.check_in_date)} đến ${formatHotelDate(booking.check_out_date)}?`,
    );
    if (confirmed) await cancel(booking.booking_id);
  }

  return (
    <main className="booking-history-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tài khoản của bạn</p>
          <h1>Lịch sử đặt phòng</h1>
          <p className="subtitle">Theo dõi các kỳ nghỉ và quản lý booking sắp tới.</p>
        </div>
        {ready && isAuthenticated && (
          <Link className="primary-link" href="/">Đặt phòng mới</Link>
        )}
      </div>

      {!ready && (
        <section className="booking-state" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <h2>Đang kiểm tra tài khoản</h2>
          <p className="muted">Vui lòng chờ trong giây lát.</p>
        </section>
      )}

      {ready && !isAuthenticated && (
        <section className="booking-state">
          <div className="state-icon" aria-hidden="true">🔐</div>
          <h2>Đăng nhập để xem booking</h2>
          <p className="muted">Lịch sử đặt phòng được bảo vệ và chỉ hiển thị cho tài khoản của bạn.</p>
          <Link className="primary-link" href="/login?next=/bookings">Đăng nhập</Link>
        </section>
      )}

      {ready && isAuthenticated && loading && (
        <section className="booking-state" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <h2>Đang tải booking</h2>
          <p className="muted">Chúng tôi đang lấy lịch sử mới nhất của bạn.</p>
        </section>
      )}

      {ready && isAuthenticated && !loading && error && bookings.length === 0 && (
        <section className="booking-state" role="alert">
          <div className="state-icon" aria-hidden="true">!</div>
          <h2>Chưa tải được lịch sử</h2>
          <p className="error">{error}</p>
          <button onClick={() => void reload()} type="button">Thử lại</button>
        </section>
      )}

      {ready && isAuthenticated && !loading && !error && bookings.length === 0 && (
        <section className="booking-state">
          <div className="state-icon" aria-hidden="true">⌂</div>
          <h2>Bạn chưa có booking nào</h2>
          <p className="muted">Chọn loại phòng và để AI tìm mức giá phù hợp cho kỳ nghỉ đầu tiên.</p>
          <Link className="primary-link" href="/">Khám phá phòng</Link>
        </section>
      )}

      {ready && isAuthenticated && !loading && bookings.length > 0 && (
        <>
          <div className="booking-feedback" aria-live="polite">
            {actionMessage && <p className="success compact-message">{actionMessage}</p>}
            {error && <p className="error action-error" role="alert">{error}</p>}
          </div>
          <section className="booking-history-list" aria-label="Danh sách đặt phòng">
            {bookings.map((booking) => (
              <BookingCard
                actionDisabled={cancellingId !== null}
                booking={booking}
                cancelling={cancellingId === booking.booking_id}
                key={booking.booking_id}
                onCancel={(selected) => void confirmCancellation(selected)}
              />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

