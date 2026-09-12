'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  History,
  KeyRound,
  LoaderCircle,
  Moon,
  ReceiptText,
  Sparkles,
  XCircle,
} from 'lucide-react';
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

function statusDetails(status: string): { label: string; badgeStyle: string } {
  switch (status.toLowerCase()) {
    case 'pending':
      return {
        label: 'Chờ đặt cọc',
        badgeStyle: 'border border-[var(--border-gold)] text-[var(--gold)] bg-[rgba(196,153,90,0.1)]',
      };
    case 'confirmed':
      return {
        label: 'Đã xác nhận',
        badgeStyle: 'border border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
      };
    case 'checkedin':
    case 'checked-in':
    case 'checked_in':
      return {
        label: 'Đang lưu trú',
        badgeStyle: 'border border-cyan-500/30 text-cyan-400 bg-cyan-500/10',
      };
    case 'completed':
    case 'checked-out':
    case 'checked_out':
      return {
        label: 'Đã hoàn thành',
        badgeStyle: 'border border-stone-500/30 text-stone-300 bg-stone-500/10',
      };
    case 'canceled':
    case 'cancelled':
      return {
        label: 'Đã hủy',
        badgeStyle: 'border border-rose-500/30 text-rose-400 bg-rose-500/10',
      };
    case 'expired':
      return {
        label: 'Hết hạn giữ phòng',
        badgeStyle: 'border border-amber-500/30 text-amber-400 bg-amber-500/10',
      };
    case 'noshow':
      return {
        label: 'Không đến nhận phòng',
        badgeStyle: 'border border-rose-500/30 text-rose-400 bg-rose-500/10',
      };
    default:
      return {
        label: status,
        badgeStyle: 'border border-[var(--border-gold)] text-[var(--muted)] bg-transparent',
      };
  }
}

const paymentStatusDetails: Record<PaymentStatus, { label: string; badgeStyle: string }> = {
  Unpaid: {
    label: 'Chưa thanh toán',
    badgeStyle: 'border border-amber-500/30 text-amber-400 bg-amber-500/10',
  },
  PartiallyPaid: {
    label: 'Thanh toán một phần',
    badgeStyle: 'border border-blue-500/30 text-blue-400 bg-blue-500/10',
  },
  Paid: {
    label: 'Đã thanh toán',
    badgeStyle: 'border border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
  },
  RefundPending: {
    label: 'Chờ hoàn tiền',
    badgeStyle: 'border border-amber-500/30 text-amber-400 bg-amber-500/10',
  },
  PartiallyRefunded: {
    label: 'Đã hoàn một phần',
    badgeStyle: 'border border-stone-500/30 text-stone-300 bg-stone-500/10',
  },
  Refunded: {
    label: 'Đã hoàn tiền',
    badgeStyle: 'border border-purple-500/30 text-purple-400 bg-purple-500/10',
  },
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
    <article
      className="p-6 md:p-8 backdrop-blur-xl border transition-all duration-300"
      style={{
        background: 'var(--bg2)',
        borderColor: 'var(--border-gold)',
      }}
    >
      {/* Card Header */}
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 mb-6" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] tracking-[0.2em] uppercase font-mono px-2 py-0.5 border" style={{ borderColor: 'var(--border-gold)', color: 'var(--gold)', background: 'var(--bg)' }}>
              #{booking.booking_id.slice(0, 8).toUpperCase()}
            </span>
            <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
              Phòng {booking.room_number}
            </span>
          </div>
          <h2 className="font-display text-2xl md:text-3xl text-[var(--fg)]">
            {booking.room_type}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] tracking-[0.14em] uppercase px-3 py-1 font-medium rounded-full ${status.badgeStyle}`}>
            {status.label}
          </span>
          <span className={`text-[10px] tracking-[0.14em] uppercase px-3 py-1 font-medium rounded-full ${payment.badgeStyle}`}>
            {payment.label}
          </span>
        </div>
      </header>

      {/* Details Grid */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 mb-6" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div>
          <dt className="text-[9px] tracking-[0.22em] uppercase font-semibold mb-1" style={{ color: 'var(--dim)' }}>
            Nhận phòng
          </dt>
          <dd className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
            {formatHotelDate(booking.check_in_date)}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-[0.22em] uppercase font-semibold mb-1" style={{ color: 'var(--dim)' }}>
            Trả phòng
          </dt>
          <dd className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
            {formatHotelDate(booking.check_out_date)}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-[0.22em] uppercase font-semibold mb-1" style={{ color: 'var(--dim)' }}>
            Thời gian
          </dt>
          <dd className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--fg)' }}>
            <Moon size={13} style={{ color: 'var(--gold)' }} />
            {booking.nights} đêm
          </dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-[0.22em] uppercase font-semibold mb-1" style={{ color: 'var(--dim)' }}>
            Giá mỗi đêm
          </dt>
          <dd className="text-sm font-medium" style={{ color: 'var(--gold)' }}>
            {formatCurrency(booking.nightly_price)}
          </dd>
        </div>
      </dl>

      {/* Contextual Notices */}
      {booking.status === 'Pending' && (
        <div
          className="p-4 mb-6 border text-xs leading-relaxed flex items-start gap-3"
          style={{
            borderColor: 'var(--border-gold)',
            background: 'rgba(196, 153, 90, 0.06)',
            color: 'var(--fg2)',
          }}
          role="status"
        >
          <Clock size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--gold)' }} />
          <div>
            Booking đang chờ đủ tiền cọc <strong style={{ color: 'var(--gold)' }}>{formatCurrency(booking.deposit_required)}</strong>.
            {' '}Còn cần cọc <strong>{formatCurrency(Math.max(0, booking.deposit_required - booking.net_paid))}</strong>.
            {booking.pending_expires_at && (
              <> Hạn giữ phòng: <span className="font-semibold text-white">{formatCreatedAt(booking.pending_expires_at)}</span> (giờ khách sạn).</>
            )}
            {' '}Liên hệ khách sạn để được hướng dẫn thanh toán trước thời hạn. Trạng thái sẽ được cập nhật sau khi khoản cọc được ghi nhận.
          </div>
        </div>
      )}

      {(booking.status === 'Expired' || booking.status === 'NoShow') && (
        <div
          className="p-4 mb-6 border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200/90 leading-relaxed flex items-start gap-3"
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
          <div>
            {booking.status === 'Expired' ? 'Thời hạn giữ phòng đã kết thúc.' : 'Booking đã được ghi nhận là khách không đến.'}
            {' '}Booking này không còn giữ phòng. Khoản hoàn tiền, nếu có, được theo dõi riêng trong lịch sử thanh toán.
          </div>
        </div>
      )}

      {/* Card Footer */}
      <footer className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <div>
          <span className="block text-[9px] tracking-[0.22em] uppercase font-semibold mb-1" style={{ color: 'var(--dim)' }}>
            Tổng giá booking
          </span>
          <strong className="font-display text-2xl md:text-3xl" style={{ color: 'var(--gold)' }}>
            {formatCurrency(booking.total_price)}
          </strong>
          <div className="text-[11px] flex flex-wrap gap-x-3 gap-y-1 mt-2" style={{ color: 'var(--muted)' }}>
            <span>Đã thu: <strong className="text-white">{formatCurrency(booking.paid_amount)}</strong></span>
            {booking.balance_due > 0 && <span>· Còn phải thu: <strong className="text-amber-300">{formatCurrency(booking.balance_due)}</strong></span>}
            {booking.refunded_amount > 0 && <span>· Đã hoàn: <strong className="text-emerald-300">{formatCurrency(booking.refunded_amount)}</strong></span>}
            {booking.refund_due > 0 && <span>· Còn phải hoàn: <strong className="text-amber-300">{formatCurrency(booking.refund_due)}</strong></span>}
          </div>
          <small className="block text-[10px] mt-2" style={{ color: 'var(--dim)' }}>
            Đặt lúc {formatCreatedAt(booking.created_at)}
          </small>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onTogglePayment(booking)}
            type="button"
            aria-expanded={paymentOpen}
            className="px-5 py-2.5 text-[10px] tracking-[0.16em] uppercase font-semibold border flex items-center gap-2 transition-all duration-200"
            style={{
              borderColor: paymentOpen ? 'var(--gold)' : 'var(--border-gold)',
              color: 'var(--gold)',
              background: paymentOpen ? 'rgba(196,153,90,0.1)' : 'transparent',
            }}
          >
            <ReceiptText size={14} />
            {paymentOpen ? 'Ẩn giao dịch' : 'Lịch sử thanh toán'}
            {paymentOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {canCancel(booking) && (
            <button
              disabled={actionDisabled}
              onClick={() => onCancel(booking)}
              type="button"
              className="px-5 py-2.5 text-[10px] tracking-[0.16em] uppercase font-semibold border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 transition-all duration-200"
            >
              {cancelling ? (
                <span className="flex items-center gap-1.5">
                  <LoaderCircle className="animate-spin" size={13} /> Đang hủy...
                </span>
              ) : (
                'Hủy đặt phòng'
              )}
            </button>
          )}
        </div>
      </footer>

      {/* Payment Transactions Accordion */}
      {paymentOpen && (
        <section
          className="mt-6 pt-6 border-t"
          style={{ borderColor: 'var(--border)' }}
          aria-live="polite"
        >
          <div className="flex items-center gap-2 mb-4">
            <CreditCard size={15} style={{ color: 'var(--gold)' }} />
            <h3 className="font-display text-lg text-[var(--fg)]">Nhật ký giao dịch thanh toán</h3>
          </div>

          {paymentLoading ? (
            <div className="py-6 flex items-center justify-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <LoaderCircle className="animate-spin" size={16} style={{ color: 'var(--gold)' }} />
              Đang tải lịch sử thanh toán…
            </div>
          ) : paymentError ? (
            <div className="p-3.5 border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs" role="alert">
              {paymentError}
            </div>
          ) : paymentSummary && paymentSummary.transactions.length > 0 ? (
            <ol className="divide-y divide-[rgba(196,153,90,0.12)]">
              {paymentSummary.transactions.map((transaction) => (
                <li
                  key={transaction.payment_id}
                  className="py-3.5 flex items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-semibold" style={{ color: 'var(--fg)' }}>
                        {transaction.transaction_type === 'Payment' ? 'Thanh toán' : 'Hoàn tiền'}
                      </strong>
                      <span className="text-[10px] px-2 py-0.5 border" style={{ borderColor: 'var(--border-gold)', color: 'var(--muted)' }}>
                        {paymentMethodLabels[transaction.method]}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1" style={{ color: 'var(--dim)' }}>
                      {formatCreatedAt(transaction.created_at)}
                      {(transaction.external_reference || transaction.note) && (
                        <span> · {transaction.external_reference || transaction.note}</span>
                      )}
                    </div>
                  </div>

                  <strong
                    className="font-display text-base tracking-wide"
                    style={{
                      color: transaction.transaction_type === 'Refund' ? '#f43f5e' : '#34d399',
                    }}
                  >
                    {transaction.transaction_type === 'Refund' ? '−' : '+'}{formatCurrency(transaction.amount)}
                  </strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-4 text-xs italic" style={{ color: 'var(--muted)' }}>
              Booking này chưa ghi nhận giao dịch thanh toán nào.
            </p>
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
    <main className="min-h-[85vh] pt-32 pb-24 px-5 md:px-10 lg:px-16 max-w-6xl mx-auto" lang="vi">
      {/* ── HEADING ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10 pb-8" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-8" style={{ background: 'var(--gold)' }} />
            <span className="text-[10px] tracking-[0.28em] uppercase font-medium" style={{ color: 'var(--gold)' }}>
              Kỳ nghỉ của bạn
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] text-[var(--fg)] mb-3">
            Lịch sử đặt phòng
          </h1>
          <p className="text-sm max-w-xl leading-relaxed" style={{ color: 'var(--muted)' }}>
            Theo dõi hành trình lưu trú, tiến độ đặt cọc và quản lý các booking của bạn tại Aurum.
          </p>
        </div>

        {ready && isAuthenticated && (
          <Link
            href="/rooms"
            className="px-6 py-3.5 text-[10px] tracking-[0.18em] uppercase font-semibold flex items-center gap-2 shrink-0 transition-colors duration-200"
            style={{ background: 'var(--gold)', color: 'var(--bg)' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--gold-hi)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--gold)')}
          >
            Đặt phòng mới <ArrowRight size={14} />
          </Link>
        )}
      </div>

      {/* ── STATE: CHECKING AUTH ── */}
      {!ready && (
        <section className="py-20 flex flex-col items-center justify-center text-center" aria-live="polite">
          <div className="w-12 h-12 rounded-full border border-[var(--border-gold)] flex items-center justify-center mb-4">
            <LoaderCircle className="animate-spin" size={22} style={{ color: 'var(--gold)' }} />
          </div>
          <h2 className="font-display text-xl text-[var(--fg)] mb-1">Đang kiểm tra tài khoản</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Vui lòng chờ trong giây lát.</p>
        </section>
      )}

      {/* ── STATE: NOT AUTHENTICATED ── */}
      {ready && !isAuthenticated && (
        <section className="p-10 md:p-14 backdrop-blur-xl border text-center max-w-xl mx-auto" style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}>
          <div className="w-16 h-16 rounded-full border mx-auto flex items-center justify-center mb-6" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>
            <KeyRound size={28} />
          </div>
          <h2 className="font-display text-3xl text-[var(--fg)] mb-3">Đăng nhập để xem đặt phòng</h2>
          <p className="text-xs leading-relaxed mb-8" style={{ color: 'var(--muted)' }}>
            Lịch sử đặt phòng được bảo mật nghiêm ngặt và chỉ hiển thị sau khi bạn xác thực tài khoản.
          </p>
          <Link
            href="/login?next=/bookings"
            className="inline-flex items-center gap-2 px-8 py-3.5 text-[11px] tracking-[0.18em] uppercase font-semibold"
            style={{ background: 'var(--gold)', color: 'var(--bg)' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--gold-hi)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--gold)')}
          >
            Đăng nhập ngay <ArrowRight size={14} />
          </Link>
        </section>
      )}

      {/* ── STATE: LOADING BOOKINGS ── */}
      {ready && isAuthenticated && loading && (
        <section className="py-20 flex flex-col items-center justify-center text-center" aria-live="polite">
          <div className="w-12 h-12 rounded-full border border-[var(--border-gold)] flex items-center justify-center mb-4">
            <LoaderCircle className="animate-spin" size={22} style={{ color: 'var(--gold)' }} />
          </div>
          <h2 className="font-display text-2xl text-[var(--fg)] mb-1">Đang tải danh sách đặt phòng</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Hệ thống đang đồng bộ dữ liệu lưu trú mới nhất của bạn.</p>
        </section>
      )}

      {/* ── STATE: ERROR ── */}
      {ready && isAuthenticated && !loading && error && bookings.length === 0 && (
        <section className="p-10 md:p-12 backdrop-blur-xl border border-rose-500/30 text-center max-w-lg mx-auto" style={{ background: 'var(--bg2)' }} role="alert">
          <div className="w-14 h-14 rounded-full border border-rose-500/40 bg-rose-500/10 flex items-center justify-center mx-auto mb-4 text-rose-400">
            <AlertCircle size={26} />
          </div>
          <h2 className="font-display text-2xl text-[var(--fg)] mb-2">Chưa tải được lịch sử đặt phòng</h2>
          <p className="text-xs text-rose-300/80 mb-6">{error}</p>
          <button
            onClick={() => void reload()}
            type="button"
            className="px-6 py-3 border text-[10px] tracking-[0.16em] uppercase font-semibold"
            style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
          >
            Thử tải lại
          </button>
        </section>
      )}

      {/* ── STATE: EMPTY BOOKINGS ── */}
      {ready && isAuthenticated && !loading && !error && bookings.length === 0 && (
        <section className="p-12 md:p-16 backdrop-blur-xl border text-center max-w-2xl mx-auto" style={{ background: 'var(--bg2)', borderColor: 'var(--border-gold)' }}>
          <div className="w-16 h-16 rounded-full border mx-auto flex items-center justify-center mb-6" style={{ borderColor: 'var(--border-gold)', color: 'var(--gold)' }}>
            <Calendar size={28} />
          </div>
          <h2 className="font-display text-3xl text-[var(--fg)] mb-3">Bạn chưa có đặt phòng nào</h2>
          <p className="text-sm max-w-md mx-auto leading-relaxed mb-8" style={{ color: 'var(--muted)' }}>
            Khám phá các hạng phòng nghỉ dưỡng sang trọng tại Aurum và để AI tối ưu mức giá tốt nhất cho kỳ nghỉ của bạn.
          </p>
          <Link
            href="/rooms"
            className="inline-flex items-center gap-2 px-8 py-3.5 text-[11px] tracking-[0.18em] uppercase font-semibold"
            style={{ background: 'var(--gold)', color: 'var(--bg)' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--gold-hi)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--gold)')}
          >
            Khám phá phòng nghỉ <ArrowRight size={14} />
          </Link>
        </section>
      )}

      {/* ── STATE: BOOKINGS LIST ── */}
      {ready && isAuthenticated && !loading && bookings.length > 0 && (
        <>
          <div className="space-y-3 mb-6" aria-live="polite">
            {actionMessage && (
              <div className="p-3.5 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
                <span>{actionMessage}</span>
              </div>
            )}
            {error && (
              <div className="p-3.5 border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-2" role="alert">
                <AlertCircle size={15} className="shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <section className="space-y-6" aria-label="Danh sách đặt phòng">
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
