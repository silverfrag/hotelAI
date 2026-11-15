'use client';

import { useState, useEffect } from 'react';
import { getCalendarPricing } from '@/services/booking.service';
import { useTranslation } from '@/hooks/useTranslation';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Info } from 'lucide-react';
import { addIsoDays } from '@/utils/businessDate';

interface CalendarPickerProps {
  roomTypeId?: number;
  initialCheckIn: string;
  initialCheckOut: string;
  businessDate: string;
  onDatesChange: (checkIn: string, checkOut: string) => void;
}

const WEEKDAYS_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WEEKDAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function CalendarPicker({
  roomTypeId,
  initialCheckIn,
  initialCheckOut,
  businessDate,
  onDatesChange,
}: CalendarPickerProps) {
  const { lang } = useTranslation();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date(`${isCalendarDate(initialCheckIn) ? initialCheckIn : businessDate}T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });

  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [pricing, setPricing] = useState<{
    key: string;
    map: Record<string, { price: number; available: number }>;
    failed: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const monthStart = currentMonth.toISOString().slice(0, 10);
  const pricingKey = `${roomTypeId ?? ''}:${monthStart}:${retry}`;
  const currentPricing = pricing?.key === pricingKey ? pricing : null;
  const pricingMap = currentPricing?.map ?? {};
  const loading = !!roomTypeId && !currentPricing;

  useEffect(() => {
    if (selectionStart && initialCheckIn !== selectionStart) setSelectionStart(null);
  }, [initialCheckIn, selectionStart]);

  useEffect(() => {
    if (!roomTypeId) return;
    const controller = new AbortController();

    async function fetchPricing() {
      try {
        const end = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
        const data = await getCalendarPricing(roomTypeId!, monthStart, end, controller.signal);
        if (controller.signal.aborted) return;

        const map: Record<string, { price: number; available: number }> = {};
        for (const item of data) {
          if (!item || !isCalendarDate(item.date) || !Number.isFinite(item.nightly_price)
            || item.nightly_price < 0 || !Number.isSafeInteger(item.available) || item.available < 0) {
            throw new Error('Invalid calendar pricing');
          }
          map[item.date] = { price: item.nightly_price, available: item.available };
        }
        setPricing({ key: pricingKey, map, failed: false });
      } catch {
        if (!controller.signal.aborted) setPricing({ key: pricingKey, map: {}, failed: true });
      }
    }
    fetchPricing();

    return () => controller.abort();
  }, [roomTypeId, monthStart, pricingKey]);

  const daysInMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const firstDay = currentMonth.getUTCDay();

  const days: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), i)).toISOString().slice(0, 10);
    days.push(dateStr);
  }

  const formatPrice = (p: number) => {
    if (p >= 1000000) {
      const millions = p / 1000000;
      return lang === 'vi' ? `${millions.toFixed(1)}Tr` : `${millions.toFixed(1)}M`;
    }
    if (p >= 1000) {
      return `${Math.round(p / 1000)}k`;
    }
    return p.toString();
  };

  const handleCellClick = (d: string) => {
    if (d < businessDate) return;

    if (!selectionStart || (selectionStart && d <= selectionStart)) {
      setSelectionStart(d);
      // Auto-set 1 night stay
      const nextDay = addIsoDays(d, 1);
      onDatesChange(d, nextDay);
    } else {
      // Complete range
      onDatesChange(selectionStart, d);
      setSelectionStart(null);
    }
  };

  const monthLabel = currentMonth.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const weekdays = lang === 'vi' ? WEEKDAYS_VI : WEEKDAYS_EN;

  return (
    <div
      className="p-5 rounded-xl border flex flex-col gap-4 text-xs select-none shadow-xl"
      style={{
        background: 'var(--bg)',
        borderColor: 'var(--border-gold)',
      }}
    >
      {/* ── HEADER NAVIGATION ── */}
      <div className="flex justify-between items-center pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <CalendarIcon size={16} style={{ color: 'var(--gold)' }} />
          <span className="font-display font-medium text-sm capitalize" style={{ color: 'var(--fg)' }}>
            {monthLabel}
          </span>
          {loading && (
            <span className="text-[10px] italic ml-2 animate-pulse" style={{ color: 'var(--gold)' }}>
              {lang === 'vi' ? 'Đang tải giá...' : 'Loading rates...'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 1, 1)))}
            className="p-1.5 rounded hover:bg-[rgba(196,153,90,0.1)] transition-colors"
            style={{ color: 'var(--gold)' }}
            aria-label="Previous Month"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1)))}
            className="p-1.5 rounded hover:bg-[rgba(196,153,90,0.1)] transition-colors"
            style={{ color: 'var(--gold)' }}
            aria-label="Next Month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {currentPricing?.failed && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-amber-400">
          <span>{lang === 'vi' ? 'Chưa tải được giá và số phòng trống. Hãy thử lại.' : 'Rates and availability could not be loaded. Please retry.'}</span>
          <button type="button" className="underline" onClick={() => setRetry((value) => value + 1)}>
            {lang === 'vi' ? 'Thử lại' : 'Retry'}
          </button>
        </div>
      )}

      {/* ── WEEKDAYS ROW ── */}
      <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] tracking-wider uppercase" style={{ color: 'var(--muted)' }}>
        {weekdays.map((day, idx) => (
          <div key={idx} className={`py-1 ${idx === 0 || idx === 6 ? 'font-semibold text-amber-300/80' : ''}`}>
            {day}
          </div>
        ))}
      </div>

      {/* ── CALENDAR DAYS GRID ── */}
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {days.map((d, i) => {
          if (!d) return <div key={`empty-${i}`} className="p-2" />;

          const p = pricingMap[d];
          const isCheckIn = d === initialCheckIn;
          const isCheckOut = d === initialCheckOut;
          const isInRange = d > initialCheckIn && d < initialCheckOut;
          const isPast = d < businessDate;
          const isAvailable = p ? p.available > 0 : true;

          let cellBg = 'var(--bg2)';
          let cellBorder = 'var(--border)';
          let textColor = 'var(--fg)';

          if (isCheckIn || isCheckOut) {
            cellBg = 'var(--gold)';
            cellBorder = 'var(--gold)';
            textColor = '#080808';
          } else if (isInRange) {
            cellBg = 'rgba(196,153,90,0.2)';
            cellBorder = 'rgba(196,153,90,0.4)';
          }

          return (
            <button
              key={d}
              type="button"
              disabled={isPast}
              aria-label={`${d}${p ? ` · ${formatPrice(p.price)} VND · ${p.available} ${lang === 'vi' ? 'phòng trống' : 'rooms available'}` : ` · ${lang === 'vi' ? 'Chưa có giá' : 'Rates unavailable'}`}`}
              aria-pressed={isCheckIn || isCheckOut || isInRange}
              onClick={() => handleCellClick(d)}
              className={`p-2 rounded-lg flex flex-col items-center justify-between min-h-[58px] transition-all duration-200 border ${
                isPast ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:scale-105 hover:border-[var(--gold)]'
              }`}
              style={{
                background: cellBg,
                borderColor: cellBorder,
                color: textColor,
              }}
            >
              <div className="flex items-center justify-between w-full">
                <span className={`text-xs font-semibold ${isCheckIn || isCheckOut ? 'text-[#080808]' : ''}`}>
                  {parseInt(d.slice(-2), 10)}
                </span>
                {isCheckIn && (
                  <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded bg-[#080808] text-[var(--gold)]">
                    {lang === 'vi' ? 'Vào' : 'In'}
                  </span>
                )}
                {isCheckOut && (
                  <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded bg-[#080808] text-[var(--gold)]">
                    {lang === 'vi' ? 'Ra' : 'Out'}
                  </span>
                )}
              </div>

              {p ? (
                <div className="w-full mt-1">
                  {isAvailable ? (
                    <div
                      className={`text-[10px] font-mono font-medium ${
                        isCheckIn || isCheckOut ? 'text-[#080808] font-bold' : ''
                      }`}
                      style={!isCheckIn && !isCheckOut ? { color: 'var(--gold)' } : {}}
                    >
                      {formatPrice(p.price)}
                    </div>
                  ) : (
                    <div className="text-[9px] font-medium text-red-400">
                      {lang === 'vi' ? 'Hết' : 'Full'}
                    </div>
                  )}
                  <div
                    className={`text-[8px] ${
                      isCheckIn || isCheckOut ? 'text-[#080808]/70' : 'text-[var(--muted)]'
                    }`}
                  >
                    {p.available} {lang === 'vi' ? 'trống' : 'left'}
                  </div>
                </div>
              ) : (
                <span className="text-[8px] mt-1">{loading ? '…' : lang === 'vi' ? 'Chưa có giá' : 'No rate'}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── FOOTER NOTE ── */}
      <div
        className="flex items-center justify-between pt-3 border-t text-[11px]"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        <div className="flex items-center gap-1.5">
          <Info size={13} style={{ color: 'var(--gold)' }} />
          <span>
            {lang === 'vi'
              ? 'Giá tham khảo cho 1 khách, 1 đêm. Báo giá cuối cùng và phòng trống được kiểm tra theo toàn bộ kỳ lưu trú.'
              : 'Indicative rates for 1 guest and 1 night. Final rates and availability are checked for your full stay.'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[10px]">
            <span className="w-2.5 h-2.5 rounded bg-[var(--gold)]" />
            {lang === 'vi' ? 'Đã chọn' : 'Selected'}
          </span>
          <span className="flex items-center gap-1 text-[10px]">
            <span className="w-2.5 h-2.5 rounded bg-[rgba(196,153,90,0.2)] border border-[rgba(196,153,90,0.4)]" />
            {lang === 'vi' ? 'Khoảng ngày' : 'Stay range'}
          </span>
        </div>
      </div>
    </div>
  );
}
