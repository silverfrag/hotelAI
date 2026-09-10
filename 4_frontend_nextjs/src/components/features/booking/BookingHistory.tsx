'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useBookingHistory } from '@/hooks/useBookingHistory';
import { BookingServiceError, getBookingPayment } from '@/services/booking.service';
import type {
  BookingPaymentSummary,
  BookingSummary,
  PaymentMethod,
  PaymentStatus,
} from '@/types/booking.type';
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
  timeZone: 'Asia/Bangkok',
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
    case 'pending':
      return { label: 'Chờ đặt cọc', className: 'payment-unpaid' };
    case 'expired':
      return { label: 'Hết hạn giữ phòng', className: 'status-cancelled' };
    case 'noshow':
      return { label: 'Không đến nhận phòng', className: 'status-cancelled' };
    case 'confirmed':
      return { label: 'Đã xác nhận', className: 'status-confirmed' };
    case 'cancelled':
    case 'canceled':
      return { label: 'Đã hủy', className: 'status-cancelled' };
    case 'checkedin':
    case 'checked-in':
    case 'checked_in':
      return { label: 'Đang lưu trú', className: 'status-active' };
    case 'checked-out':
    case 'checked_out':
    case 'completed':
      return { label: 'Đã hoàn thành', className: 'status-completed' };
    default:
      return { label: status, className: 'status-default' };
  }
}

const paymentStatusDetails: Record<PaymentStatus, { label: string; className: string }> = {
  Unpaid: { label: 'Chưa thanh toán', className: 'payment-unpaid' },
  PartiallyPaid: { label: 'Thanh toán một phần', className: 'payment-partial' },
  Paid: { label: 'Đã thanh toán', className: 'payment-paid' },
  RefundPending: { label: 'Chờ hoàn tiền', className: 'payment-refund-pending' },
  PartiallyRefunded: { label: 'Đã hoàn một phần', className: 'payment-partial' },
  Refunded: { label: 'Đã hoàn tiền', className: 'payment-refunded' },
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  Cash: 'Tiền mặt',
  BankTransfer: 'Chuyển khoản',
  CardTerminal: 'Thẻ tại quầy',
};

function canCancel(booking: BookingSummary): boolean {
  return booking.can_cancel;
}

interface BookingCardProps {
  booking: BookingSummary;
  cancelling: boolean;
  actionDisabled: boolean;
  paymentOpen: boolean;
  paymentLoading: boolean;
  paymentError: string;
  paymentSummary: BookingPaymentSummary | null;
  onCancel: (booking: BookingSummary) => void;
  onTogglePayment: (booking: BookingSummary) => void;
}

function BookingCard({
  booking,
  cancelling,
  actionDisabled,
  paymentOpen,
  paymentLoading,
  paymentError,
  paymentSummary,
  onCancel,
  onTogglePayment,
}: BookingCardProps) {
  const status = statusDetails(booking.status);
  const payment = paymentStatusDetails[booking.payment_status] ?? paymentStatusDetails.Unpaid;

  return (
    <article className="booking-history-card">
      <header className="booking-card-header">
        <div>
          <p className="booking-reference">Mã đặt phòng #{booking.booking_id.slice(0, 8).toUpperCase()}</p>
          <h2>{booking.room_type}</h2>
          <p className="muted">Phòng {booking.room_number}</p>
        </div>
        <div className="booking-status-stack">
          <span className={`booking-status ${status.className}`}>{status.label}</span>
          <span className={`booking-status ${payment.className}`}>{payment.label}</span>
        </div>
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

      {booking.status === 'Pending' && (
        <p className="muted" role="status">
          Booking đang chờ đủ tiền cọc {formatCurrency(booking.deposit_required)}.
          {' '}Còn cần cọc {formatCurrency(Math.max(0, booking.deposit_required - booking.net_paid))}.
          {booking.pending_expires_at && <> Hạn giữ phòng: {formatCreatedAt(booking.pending_expires_at)} (giờ khách sạn).</>}
          {' '}Liên hệ khách sạn để được hướng dẫn thanh toán trước thời hạn. Trạng thái sẽ được cập nhật sau khi khoản cọc được ghi nhận.
        </p>
      )}
      {(booking.status === 'Expired' || booking.status === 'NoShow') && (
        <p className="muted">
          {booking.status === 'Expired' ? 'Thời hạn giữ phòng đã kết thúc.' : 'Booking đã được ghi nhận là khách không đến.'}
          {' '}Booking này không còn giữ phòng. Khoản hoàn tiền, nếu có, được theo dõi riêng trong lịch sử thanh toán.
        </p>
      )}

      <footer className="booking-card-footer">
        <div>
          <span className="muted">Tổng giá booking</span>
          <strong>{formatCurrency(booking.total_price)}</strong>
          <span className="booking-payment-balance">
            Đã thu {formatCurrency(booking.paid_amount)}
            {booking.balance_due > 0 && <> · Còn phải thu {formatCurrency(booking.balance_due)}</>}
            {booking.refunded_amount > 0 && <> · Đã hoàn {formatCurrency(booking.refunded_amount)}</>}
            {booking.refund_due > 0 && <> · Còn phải hoàn {formatCurrency(booking.refund_due)}</>}
          </span>
          <small>Đặt lúc {formatCreatedAt(booking.created_at)}</small>
        </div>
        <div className="booking-card-actions">
          <button
            className="payment-history-button"
            onClick={() => onTogglePayment(booking)}
            type="button"
            aria-expanded={paymentOpen}
          >
            {paymentOpen ? 'Ẩn giao dịch' : 'Lịch sử thanh toán'}
          </button>
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
        </div>
      </footer>

      {paymentOpen && (
        <section className="payment-history-panel" aria-live="polite">
          {paymentLoading ? (
            <p className="muted">Đang tải lịch sử thanh toán…</p>
          ) : paymentError ? (
            <p className="error" role="alert">{paymentError}</p>
          ) : paymentSummary && paymentSummary.transactions.length > 0 ? (
            <ol className="payment-transaction-list">
              {paymentSummary.transactions.map((transaction) => (
                <li key={transaction.payment_id}>
                  <div>
                    <strong>{transaction.transaction_type === 'Payment' ? 'Thanh toán' : 'Hoàn tiền'}</strong>
                    <span>
                      {paymentMethodLabels[transaction.method]} · {formatCreatedAt(transaction.created_at)}
                    </span>
                    {(transaction.external_reference || transaction.note) && (
                      <small>{transaction.external_reference || transaction.note}</small>
                    )}
                  </div>
                  <strong className={transaction.transaction_type === 'Refund' ? 'refund-amount' : ''}>
                    {transaction.transaction_type === 'Refund' ? '−' : '+'}{formatCurrency(transaction.amount)}
                  </strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Booking này chưa có giao dịch thanh toán.</p>
          )}
        </section>
      )}
    </article>
  );
}

export function BookingHistory() {
  const { accessToken, isAuthenticated, ready, invalidateSession } = useAuth();
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<BookingPaymentSummary | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const paymentController = useRef<AbortController | null>(null);
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
    onUnauthorized: invalidateSession,
  });

  useEffect(() => () => paymentController.current?.abort(), []);

  async function loadPayment(bookingId: string) {
    if (!accessToken) return;
    paymentController.current?.abort();
    const controller = new AbortController();
    paymentController.current = controller;
    setPaymentSummary(null);
    setPaymentError('');
    setPaymentLoading(true);
    try {
      const summary = await getBookingPayment(bookingId, accessToken, controller.signal);
      if (!controller.signal.aborted) setPaymentSummary(summary);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (caught instanceof BookingServiceError && caught.status === 401) invalidateSession();
      if (!controller.signal.aborted) {
        setPaymentError(caught instanceof Error ? caught.message : 'Không thể tải lịch sử thanh toán.');
      }
    } finally {
      if (!controller.signal.aborted) setPaymentLoading(false);
    }
  }

  function togglePayment(booking: BookingSummary) {
    if (paymentBookingId === booking.booking_id) {
      paymentController.current?.abort();
      setPaymentBookingId(null);
      setPaymentSummary(null);
      setPaymentError('');
      setPaymentLoading(false);
      return;
    }
    setPaymentBookingId(booking.booking_id);
    void loadPayment(booking.booking_id);
  }

  async function confirmCancellation(booking: BookingSummary) {
    const confirmed = window.confirm(
      `Bạn có chắc muốn hủy phòng ${booking.room_number} từ ${formatHotelDate(booking.check_in_date)} đến ${formatHotelDate(booking.check_out_date)}?`,
    );
    if (confirmed) {
      const canceled = await cancel(booking.booking_id);
      if (canceled && paymentBookingId === booking.booking_id) {
        await loadPayment(booking.booking_id);
      }
    }
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
                onTogglePayment={togglePayment}
                paymentError={paymentBookingId === booking.booking_id ? paymentError : ''}
                paymentLoading={paymentBookingId === booking.booking_id && paymentLoading}
                paymentOpen={paymentBookingId === booking.booking_id}
                paymentSummary={paymentBookingId === booking.booking_id ? paymentSummary : null}
              />
            ))}
          </section>
        </>
      )}
    </main>
  );
}
