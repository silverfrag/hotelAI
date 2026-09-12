'use client';

import { ArrowRight, CalendarDays, Sparkles, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { createQuoteSearchId } from '@/services/quote-telemetry';
import { RoomType } from '@/types/room.type';
import { useTranslation } from '@/contexts/LanguageContext';

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface BookingFormProps {
  roomTypes: RoomType[];
  businessDate: string;
  initialRoomTypeId?: number;
  compact?: boolean;
}

export function BookingForm({
  roomTypes,
  businessDate,
  initialRoomTypeId,
  compact = false,
}: BookingFormProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const defaultRoomTypeId = roomTypes.some((room) => room.type_id === initialRoomTypeId)
    ? initialRoomTypeId
    : roomTypes[0]?.type_id;

  const minCheckIn = businessDate;
  const defaultCheckIn = businessDate;
  const defaultCheckOut = addDays(businessDate, 2);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const values = new FormData(event.currentTarget);
    const roomTypeId = Number(values.get('room_type_id'));
    const checkInDate = String(values.get('check_in_date') ?? '');
    const checkOutDate = String(values.get('check_out_date') ?? '');
    const guestCount = Number(values.get('guest_count') ?? 1);
    const requests = Number(values.get('requests') ?? 0);

    if (!Number.isInteger(roomTypeId) || roomTypeId < 1) {
      setError(t('search_validation_room'));
      return;
    }
    if (checkInDate < businessDate) {
      setError(t('search_validation_checkin'));
      return;
    }
    if (checkOutDate <= checkInDate) {
      setError(t('search_validation_checkout'));
      return;
    }
    const selectedRoom = roomTypes.find((room) => room.type_id === roomTypeId);
    if (!selectedRoom || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > selectedRoom.capacity) {
      setError(`Số khách phải từ 1 đến ${selectedRoom?.capacity ?? 1}.`);
      return;
    }

    const query = new URLSearchParams({
      room_type_id: String(roomTypeId),
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      guest_count: String(guestCount),
      requests: String(requests),
      search_id: createQuoteSearchId(),
    });
    router.push(`/checkout?${query.toString()}`);
  }

  return (
    <div className={`w-full max-w-6xl mx-auto ${compact ? '' : '-mt-16 sm:-mt-20 relative z-30 px-4'}`}>
      <form
        onSubmit={submit}
        className="rounded-[32px] p-6 sm:p-8 bg-[var(--bg-glass-card)] border border-[var(--border-gold)] backdrop-blur-2xl shadow-2xl transition-all"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[var(--gold-light)] flex items-center justify-center text-[var(--gold-primary)]">
              <Sparkles size={16} />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--gold-primary)] block">
                {t('search_badge')}
              </span>
              <h3 className="font-serif text-lg sm:text-xl font-bold text-[var(--text-primary)]">
                {t('search_title')}
              </h3>
            </div>
          </div>
          {error && (
            <div className="px-4 py-2 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {/* Suite Category */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
              {t('search_room_type')}
            </label>
            <div className="relative">
              <select
                name="room_type_id"
                defaultValue={defaultRoomTypeId}
                required
                disabled={roomTypes.length === 0}
                className="w-full px-4 py-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-semibold focus:outline-none focus:border-[var(--gold-primary)] shadow-sm cursor-pointer appearance-none"
              >
                {roomTypes.map((room) => (
                  <option key={room.type_id} value={room.type_id}>
                    {room.type_name}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-muted)] text-xs">
                ▼
              </div>
            </div>
          </div>

          {/* Check-In Date */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
              {t('search_check_in')}
            </label>
            <div className="relative">
              <input
                type="date"
                name="check_in_date"
                defaultValue={defaultCheckIn}
                min={minCheckIn}
                required
                className="w-full px-4 py-3.5 pl-11 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-semibold focus:outline-none focus:border-[var(--gold-primary)] shadow-sm"
              />
              <CalendarDays size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--gold-primary)]" />
            </div>
          </div>

          {/* Check-Out Date */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
              {t('search_check_out')}
            </label>
            <div className="relative">
              <input
                type="date"
                name="check_out_date"
                defaultValue={defaultCheckOut}
                min={minCheckIn}
                required
                className="w-full px-4 py-3.5 pl-11 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-semibold focus:outline-none focus:border-[var(--gold-primary)] shadow-sm"
              />
              <CalendarDays size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--gold-primary)]" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
              {t('checkout_guest_count_label')}
            </label>
            <input
              type="number"
              name="guest_count"
              defaultValue={1}
              min={1}
              max={roomTypes.find((room) => room.type_id === defaultRoomTypeId)?.capacity ?? 1}
              required
              className="w-full px-4 py-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-semibold focus:outline-none focus:border-[var(--gold-primary)] shadow-sm"
            />
          </div>

          {/* Submit CTA */}
          <div className="flex flex-col justify-end space-y-2">
            <label className="hidden lg:block text-xs font-bold uppercase tracking-wider opacity-0">
              Submit
            </label>
            <button
              type="submit"
              className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-[var(--gold-primary)] to-[var(--gold-secondary)] text-white text-sm font-bold shadow-lg hover:shadow-xl hover:brightness-105 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{t('search_submit')}</span>
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
