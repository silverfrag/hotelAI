'use client';

import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useReservation } from '@/hooks/useReservation';
import { ReservationRecoverySignIn } from '@/components/features/auth/ReservationRecoverySignIn';
import { useTranslation } from '@/contexts/LanguageContext';
import { QuoteCountdownTimer } from '@/components/ui/LuxuryWidgets';
import type { PriceQuoteInput } from '@/services/booking.service';
import type { BookingStatus, PaymentStatus } from '@/types/booking.type';
import type { RoomType } from '@/types/room.type';

interface CheckoutFormProps {
  roomTypes: RoomType[];
  businessDate: string;
  initialRoomTypeId: number;
  initialCheckInDate: string;
  initialCheckOutDate: string;
  initialGuestCount: number;
  initialRequests: number;
  initialSearchId: string;
}

const GALLERY_IMAGES = [
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1000&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=600&auto=format&fit=crop&q=80',
];

const bookingStatusLabels: Record<BookingStatus, string> = {
  Pending: 'Chờ đặt cọc', Confirmed: 'Đã xác nhận', CheckedIn: 'Đang lưu trú',
  Completed: 'Đã hoàn tất', Canceled: 'Đã hủy', Expired: 'Hết hạn giữ phòng', NoShow: 'Không đến nhận phòng',
};
const paymentStatusLabels: Record<PaymentStatus, string> = {
  Unpaid: 'Chưa thanh toán', PartiallyPaid: 'Thanh toán một phần', Paid: 'Đã thanh toán',
  RefundPending: 'Chờ hoàn tiền', PartiallyRefunded: 'Đã hoàn một phần', Refunded: 'Đã hoàn tiền',
};

function formatDeadline(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(parsed);
}

export function CheckoutForm({
  roomTypes,
  businessDate,
  initialRoomTypeId,
  initialCheckInDate,
  initialCheckOutDate,
  initialGuestCount,
  initialRequests,
  initialSearchId,
}: CheckoutFormProps) {
  const { isAuthenticated, ready } = useAuth();
  const { t, formatPrice } = useTranslation();
  const [roomTypeId, setRoomTypeId] = useState(initialRoomTypeId);
  const [checkInDate, setCheckInDate] = useState(initialCheckInDate);
  const [checkOutDate, setCheckOutDate] = useState(initialCheckOutDate);
  const [guestCount, setGuestCount] = useState(initialGuestCount);
  const [requests, setRequests] = useState(initialRequests);

  const selectedRoom = roomTypes.find((room) => room.type_id === roomTypeId) ?? roomTypes[0];
  const quoteInput = useMemo<PriceQuoteInput | null>(() => {
    if (
      !selectedRoom
      || checkInDate < businessDate
      || checkOutDate <= checkInDate
      || requests < 0
      || requests > 5
      || guestCount < 1
      || guestCount > selectedRoom.capacity
    ) return null;

    return {
      room_type_id: selectedRoom.type_id,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      total_of_special_requests: requests,
      guest_count: guestCount,
    };
  }, [businessDate, checkInDate, checkOutDate, guestCount, requests, selectedRoom]);

  const {
    quote, loading: quoteLoading, quoteError, error: actionError, result,
    expired, submitting, retryOnly, recoveryAccount, recoveryNeedsSignIn, confirm, changeSelection, refreshQuote,
  } = useReservation(quoteInput, initialSearchId);
  const selectionLocked = submitting || Boolean(result) || retryOnly;

  const checkoutQuery = new URLSearchParams({
    room_type_id: String(selectedRoom?.type_id ?? ''),
    check_in_date: checkInDate,
    check_out_date: checkOutDate,
    guest_count: String(guestCount),
    requests: String(requests),
    search_id: initialSearchId,
  }).toString();
  const nextUrl = `/checkout?${checkoutQuery}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await confirm();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      {/* Page Header */}
      <div className="mb-8 sm:mb-12">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--gold-primary)] font-bold mb-2">
          <Sparkles size={14} /> {quote?.pricing_source === 'ai' ? 'Báo giá AI' : 'Báo giá phòng'}
        </div>
        <h1 className="font-serif text-3xl sm:text-5xl font-bold text-[var(--text-primary)]">
          {t('checkout_title')}
        </h1>
        <p className="text-sm sm:text-base text-[var(--text-secondary)] mt-2">
          Kiểm tra giá và tình trạng phòng theo kỳ lưu trú, sau đó gửi yêu cầu đặt phòng.
        </p>
      </div>

      {/* Main 2-Column Luxury Layout (Inspired by Mẫu 1) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-start">
        {/* Left Column (7 cols on lg): Gallery + Amenities + Details + Inputs */}
        <div className="lg:col-span-7 space-y-10">
          {/* Asymmetric Photo Gallery (Mẫu 1) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 rounded-[32px] overflow-hidden p-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm">
            {/* Master Bedroom Hero Photo */}
            <div className="sm:col-span-2 h-72 sm:h-96 rounded-2xl overflow-hidden relative group">
              <img
                src={GALLERY_IMAGES[0]}
                alt="Ảnh minh họa không gian lưu trú"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-white text-xs font-semibold">
                Ảnh minh họa
              </div>
            </div>

            {/* Stacked Side Photos */}
            <div className="grid grid-cols-2 sm:grid-cols-1 gap-3.5 h-full">
              <div className="h-36 sm:h-[184px] rounded-2xl overflow-hidden relative group">
                <img
                  src={GALLERY_IMAGES[1]}
                  alt="Ảnh minh họa nội thất phòng"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
              </div>
              <div className="h-36 sm:h-[184px] rounded-2xl overflow-hidden relative group">
                <img
                  src={GALLERY_IMAGES[2]}
                  alt="Ảnh minh họa phòng nghỉ"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
              </div>
            </div>
          </div>

          {/* Title & Tag Pills (Mẫu 1) */}
          <div>
            <h2 className="font-serif text-3xl font-bold text-[var(--text-primary)]">
              {selectedRoom?.type_name ?? 'Hạng phòng'}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] flex items-center gap-1.5 mt-1">
              Hình ảnh minh họa; thông tin loại phòng và giá được cập nhật từ khách sạn.
            </p>
          </div>

          {/* Backend room facts */}
          <div className="p-6 rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-4">
              Thông tin loại phòng
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[var(--text-primary)]">Sức chứa: {selectedRoom?.capacity}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[var(--text-primary)]">Tổng phòng: {selectedRoom?.total_rooms}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[var(--text-primary)]">Sẵn sàng hôm nay: {selectedRoom?.available_now}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[var(--text-primary)]">Giá cơ sở: {selectedRoom ? formatPrice(selectedRoom.base_price) : '-'}</span>
              </div>
            </div>
          </div>

          {/* Edit Stay Form Inputs */}
          <div className="p-6 sm:p-8 rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm space-y-6">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-[var(--gold-primary)] text-white text-xs font-bold flex items-center justify-center">
                1
              </span>
              <h3 className="font-serif text-xl font-bold text-[var(--text-primary)]">
                Tùy chỉnh thông tin kỳ nghỉ
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Room Selector */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('search_room_type')}
                </label>
                <select
                  value={selectedRoom?.type_id ?? ''}
                  disabled={selectionLocked}
                  onChange={(e) => {
                    if (selectionLocked || Number(e.target.value) === selectedRoom?.type_id) return;
                    changeSelection();
                    const nextRoom = roomTypes.find((room) => room.type_id === Number(e.target.value));
                    setRoomTypeId(Number(e.target.value));
                    setGuestCount((count) => Math.min(count, nextRoom?.capacity ?? count));
                  }}
                  className="w-full px-4 py-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold-primary)]"
                >
                  {roomTypes.map((r) => (
                    <option key={r.type_id} value={r.type_id}>
                      {r.type_name} (Tối đa {r.capacity} khách)
                    </option>
                  ))}
                </select>
              </div>

              {/* Check-in */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('search_check_in')}
                </label>
                <div className="relative">
                  <input
                    type="date"
                    disabled={selectionLocked}
                    min={businessDate}
                    value={checkInDate}
                    onChange={(e) => {
                      if (selectionLocked || e.target.value === checkInDate) return;
                      changeSelection();
                      setCheckInDate(e.target.value);
                    }}
                    required
                    className="w-full px-4 py-3 pl-11 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold-primary)]"
                  />
                  <CalendarDays size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--gold-primary)]" />
                </div>
              </div>

              {/* Check-out */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('search_check_out')}
                </label>
                <div className="relative">
                  <input
                    type="date"
                    disabled={selectionLocked}
                    min={checkInDate || businessDate}
                    value={checkOutDate}
                    onChange={(e) => {
                      if (selectionLocked || e.target.value === checkOutDate) return;
                      changeSelection();
                      setCheckOutDate(e.target.value);
                    }}
                    required
                    className="w-full px-4 py-3 pl-11 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold-primary)]"
                  />
                  <CalendarDays size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--gold-primary)]" />
                </div>
              </div>

              {/* Special Requests */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('checkout_guest_count_label')}
                </label>
                <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
                  <Users size={18} className="text-[var(--gold-primary)]" />
                  <button
                    type="button"
                    disabled={selectionLocked || guestCount <= 1}
                    onClick={() => {
                      if (selectionLocked || guestCount <= 1) return;
                      changeSelection();
                      setGuestCount((count) => Math.max(1, count - 1));
                    }}
                    className="w-8 h-8 rounded-full border border-[var(--border-gold)] text-lg text-[var(--gold-primary)] disabled:opacity-40"
                    aria-label="Giảm số khách"
                  >
                    -
                  </button>
                  <span className="min-w-8 text-center text-sm font-bold text-[var(--text-primary)]">{guestCount}</span>
                  <button
                    type="button"
                    disabled={selectionLocked || !selectedRoom || guestCount >= selectedRoom.capacity}
                    onClick={() => {
                      if (selectionLocked || !selectedRoom || guestCount >= selectedRoom.capacity) return;
                      changeSelection();
                      setGuestCount((count) => Math.min(selectedRoom?.capacity ?? count, count + 1));
                    }}
                    className="w-8 h-8 rounded-full border border-[var(--border-gold)] text-lg text-[var(--gold-primary)] disabled:opacity-40"
                    aria-label="Tăng số khách"
                  >
                    +
                  </button>
                  <span className="ml-auto text-xs text-[var(--text-muted)]">Tối đa {selectedRoom?.capacity ?? 1}</span>
                </div>
              </div>

              {/* Special Requests */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('checkout_special_requests_label')}
                </label>
                <select
                  value={requests}
                  disabled={selectionLocked}
                  onChange={(e) => {
                    if (selectionLocked || Number(e.target.value) === requests) return;
                    changeSelection();
                    setRequests(Number(e.target.value));
                  }}
                  className="w-full px-4 py-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold-primary)]"
                >
                  {[0, 1, 2, 3, 4, 5].map((val) => (
                    <option key={val} value={val}>
                      {val} yêu cầu đặc biệt
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--text-muted)]">Số lượng yêu cầu không xác nhận dịch vụ bổ sung. Liên hệ khách sạn để thống nhất nội dung.</p>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column (5 cols on lg): Sticky Glass AI Dynamic Pricing Card (Mẫu 1) */}
        <div className="lg:col-span-5 sticky top-28 space-y-6">
          <div className="p-6 sm:p-8 rounded-[36px] bg-[var(--bg-glass-card)] border border-[var(--border-gold)] backdrop-blur-2xl shadow-2xl space-y-6">
            {/* Header with Nightly Rate & AI Badge */}
            <div className="flex items-start justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                  {t('checkout_summary_title')}
                </span>
                <div className="flex items-baseline gap-2">
                  <strong className="font-serif text-3xl font-bold text-[var(--text-primary)]">
                    {quote ? formatPrice(quote.nightly_price) : selectedRoom ? formatPrice(selectedRoom.base_price) : '...'}
                  </strong>
                  <span className="text-xs text-[var(--text-muted)] font-medium">{t('room_per_night')}</span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5">
                {quote && (
                  <span className="text-[11px] font-semibold text-[var(--gold-primary)]">
                    {quote.pricing_source === 'ai' ? `Điều chỉnh AI: ×${quote.ai_multiplier}` : 'Giá cơ sở'}
                  </span>
                )}
              </div>
            </div>

            {/* Quote Guarantee Countdown Timer */}
            {quote && !result && (
              <div className="py-1">
                <QuoteCountdownTimer
                  expiresAt={quote.price_guaranteed_until}
                  label={t('checkout_quote_guarantee')}
                />
                <p className="mt-2 text-xs text-[var(--text-muted)]">Báo giá chưa giữ phòng. Tồn phòng được kiểm tra lại khi đặt.</p>
              </div>
            )}

            {/* Detailed Cost Breakdown Table (Mẫu 1) */}
            {quoteLoading ? (
              <div className="py-6 flex flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                <LoaderCircle size={22} className="animate-spin text-[var(--gold-primary)]" />
                <span>Đang cập nhật báo giá...</span>
              </div>
            ) : quote ? (
              <div className="space-y-2.5 pt-4 border-t border-[var(--border-subtle)] text-xs">
                <div className="flex items-center justify-between text-[var(--text-secondary)]">
                  <span>{quote.nights} {t('checkout_nights')} × {formatPrice(quote.nightly_price)}</span>
                  <span className="font-semibold tabular-nums">{formatPrice(quote.total_price)}</span>
                </div>
                <div className="flex items-center justify-between text-[var(--text-secondary)]">
                  <span>Nguồn báo giá</span>
                  <span className="font-semibold text-[var(--gold-primary)]">{quote.pricing_source === 'ai' ? 'Định giá AI' : 'Giá cơ sở'}</span>
                </div>

                {/* Total Cost */}
                <div className="pt-4 mt-2 border-t border-[var(--border-subtle)] flex items-baseline justify-between">
                  <span className="text-sm font-bold text-[var(--text-primary)]">{t('checkout_total')}</span>
                  <strong className="font-serif text-2xl sm:text-3xl font-bold text-[var(--gold-primary)] tabular-nums">
                    {formatPrice(quote.total_price)}
                  </strong>
                </div>

                {/* Availability status */}
                {!result && <div className="pt-2">
                  <span className={`text-xs font-semibold flex items-center gap-1.5 ${
                    quote.rooms_available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                  }`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {quote.rooms_available > 0
                      ? `Còn ${quote.rooms_available} phòng sẵn sàng trong kỳ đã chọn`
                      : 'Hết phòng trong kỳ lưu trú này'}
                  </span>
                </div>}
              </div>
            ) : null}

            <div className="pt-3 border-t border-[var(--border-subtle)]">
              <p className="text-xs leading-5 text-[var(--text-secondary)]">Liên hệ khách sạn để được hướng dẫn thanh toán và ghi nhận tiền cọc. Chính sách cọc và hạn giữ phòng sẽ được hiển thị sau khi tạo booking. Màn hình này không thu tiền.</p>
            </div>

            {!selectionLocked && (expired || quoteError || (!quote && !quoteLoading && quoteInput)) && (
              <button type="button" onClick={refreshQuote} className="text-sm font-semibold text-[var(--gold-primary)] underline">
                {expired ? 'Báo giá đã hết hạn — lấy báo giá mới' : 'Thử lại báo giá'}
              </button>
            )}
            {!quoteInput && <p className="text-xs text-rose-600" role="alert">Chọn loại phòng, ngày lưu trú và số khách hợp lệ để nhận báo giá.</p>}
            {retryOnly && <p className="text-xs leading-5 text-[var(--text-secondary)]" role="status">Chưa nhận được kết quả chắc chắn. Giữ trang này mở để khôi phục yêu cầu hiện tại; trước khi tải lại hoặc rời trang, kiểm tra <Link href="/bookings" target="_blank" rel="noopener noreferrer" className="underline">lịch sử đặt phòng trong thẻ khác</Link>.</p>}

            {/* Error Message */}
            {(actionError || quoteError) && (
              <div role="alert" className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                <CircleAlert size={16} />
                <span>{actionError || quoteError}</span>
              </div>
            )}

            {/* Auth Note / Confirmation CTA */}
            {!ready ? (
              <div className="text-center py-2 text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                <LoaderCircle size={16} className="animate-spin" /> Đang kiểm tra phiên làm việc...
              </div>
            ) : recoveryNeedsSignIn && recoveryAccount ? (
              <ReservationRecoverySignIn account={recoveryAccount} />
            ) : !isAuthenticated ? (
              <div className="space-y-3">
                <div className="p-4 rounded-2xl bg-[var(--gold-light)] border border-[var(--border-gold)] text-xs text-[var(--text-secondary)] flex items-start gap-3">
                  <LockKeyhole size={18} className="text-[var(--gold-primary)] flex-shrink-0 mt-0.5" />
                  <p>
                    {t('checkout_need_login_msg')}{' '}
                    <Link href={`/login?next=${encodeURIComponent(nextUrl)}`} className="font-bold text-[var(--gold-primary)] underline">
                      {t('nav_login')}
                    </Link>{' '}
                    hoặc{' '}
                    <Link href={`/register?next=${encodeURIComponent(nextUrl)}`} className="font-bold text-[var(--gold-primary)] underline">
                      {t('nav_register')}
                    </Link>.
                  </p>
                </div>
                <Link
                  href={`/login?next=${encodeURIComponent(nextUrl)}`}
                  className="w-full py-4 rounded-full bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] hover:border-[var(--gold-primary)] text-[var(--text-primary)] text-xs font-bold text-center block transition-all"
                >
                  {t('checkout_login_btn')}
                </Link>
              </div>
            ) : !result ? (
              <form onSubmit={submit}>
                <button
                  type="submit"
                  disabled={
                    submitting
                    || (expired && !retryOnly)
                    || quoteLoading
                    || !ready
                    || !isAuthenticated
                    || recoveryNeedsSignIn
                    || !quote
                    || (!retryOnly && quote.rooms_available < 1)
                  }
                  className="w-full py-4 rounded-full bg-gradient-to-r from-[var(--gold-primary)] to-[var(--gold-secondary)] text-white text-sm font-bold shadow-xl hover:shadow-2xl hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <LoaderCircle size={17} className="animate-spin" />
                      <span>{t('checkout_processing')}</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={18} />
                      <span>{retryOnly ? 'Kiểm tra lại yêu cầu đặt phòng' : 'Tạo đặt phòng'}</span>
                    </>
                  )}
                </button>
              </form>
            ) : null}

            {/* Booking Success Confirmation Banner */}
            {result && (
              <div role="status" className="p-5 rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-gold)] text-[var(--text-primary)] text-xs space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <BadgeCheck size={20} className="text-emerald-600 dark:text-emerald-400" />
                  <span>{bookingStatusLabels[result.booking.status]}</span>
                </div>
                <p>
                  Booking phòng <strong>{result.room_number}</strong>. Tổng giá booking:{' '}
                  <strong className="tabular-nums">{formatPrice(result.total_price ?? result.applied_price)}</strong>.
                </p>
                {result.booking.status === 'Pending' && <p>
                  Cần đặt cọc <strong>{formatPrice(result.booking.deposit_required)}</strong>
                  {result.booking.pending_expires_at && <> trước <strong>{formatDeadline(result.booking.pending_expires_at)}</strong> (giờ khách sạn)</>}.
                  {' '}Liên hệ khách sạn để ghi nhận cọc trước hạn giữ phòng. Booking sẽ được xác nhận khi nhận đủ cọc đúng hạn.
                </p>}
                {result.booking.status === 'Confirmed' && <p>Đặt phòng đã được xác nhận. Xem lịch sử booking để theo dõi trạng thái mới nhất.</p>}
                {['Canceled', 'Expired', 'NoShow'].includes(result.booking.status) && <p>Booking này không còn giữ phòng. Xem lịch sử thanh toán để kiểm tra khoản hoàn tiền, nếu có.</p>}
                <p>Thanh toán: <strong>{paymentStatusLabels[result.payment_status]}</strong>. Đã ghi nhận {formatPrice(result.paid_amount)} · Còn phải thu {formatPrice(result.balance_due)}.</p>
                {result.booking.checkout_payment_required && ['Pending', 'Confirmed', 'CheckedIn'].includes(result.booking.status) && <p>Khách sạn yêu cầu thanh toán đủ trước khi trả phòng, trừ khi được duyệt công nợ.</p>}
                <p className="text-[11px] opacity-80">
                  Mã booking: <code className="font-mono">{result.booking.booking_id}</code>
                </p>
                <Link
                  href="/bookings"
                  className="inline-flex items-center gap-1.5 font-bold underline hover:no-underline pt-1 text-[var(--gold-primary)]"
                >
                  <span>{t('checkout_success_cta')}</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
