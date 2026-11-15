'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles, Users } from 'lucide-react';
import { mapApiRoomToPresentation } from '@/services/room-presentation';
import { RoomType } from '@/types/room.type';
import { useTranslation } from '@/contexts/LanguageContext';

export function RoomCard({ room }: { room: RoomType }) {
  const { t, formatPrice } = useTranslation();
  const imageUrl = mapApiRoomToPresentation(room).img;

  return (
    <article className="group flex flex-col rounded-[32px] overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--gold-secondary)] shadow-md hover:shadow-2xl transition-all duration-500 hover:-translate-y-1.5">
      {/* Architectural Arched Image Container (Mẫu 2) */}
      <div className="relative h-64 sm:h-72 w-full overflow-hidden bg-neutral-900">
        <img
          src={imageUrl}
          alt={room.type_name}
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700 ease-out brightness-[0.95] group-hover:brightness-100"
        />
        {/* Availability Badge */}
        <div className="absolute top-4 left-4 z-10">
          <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-md ${
            room.available_now > 0
              ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-500/30'
              : 'bg-rose-950/70 text-rose-300 border border-rose-500/30'
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            {room.available_now > 0 ? `${room.available_now} ${t('room_available')}` : t('room_booked')}
          </span>
        </div>

        {/* AI Dynamic Badge */}
        <div className="absolute top-4 right-4 z-10">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--bg-glass)] text-[var(--gold-primary)] border border-[var(--border-gold)] backdrop-blur-md shadow-sm">
            <Sparkles size={13} />
            <span>AI Dynamic</span>
          </span>
        </div>

        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
      </div>

      {/* Card Body */}
      <div className="flex-1 p-6 sm:p-7 flex flex-col justify-between gap-5">
        <div>
          {/* Catalog facts supplied by the backend */}
          <div className="flex items-center gap-4 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            <span className="inline-flex items-center gap-1">
              <Users size={14} className="text-[var(--gold-primary)]" /> {room.capacity} {t('room_capacity')}
            </span>
            <span>{room.total_rooms} {t('room_total')}</span>
          </div>

          <h3 className="font-serif text-2xl font-bold text-[var(--text-primary)] group-hover:text-[var(--gold-primary)] transition-colors">
            {room.type_name}
          </h3>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-2 line-clamp-2 leading-relaxed">
            {t('rooms_subtitle')}
          </p>
        </div>

        {/* Pricing & Action */}
        <div className="pt-5 border-t border-[var(--border-subtle)] flex items-end justify-between gap-4">
          <div>
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold block">
              {t('room_base_price')}
            </span>
            <div className="flex items-baseline gap-1">
              <strong className="font-serif text-2xl font-bold text-[var(--text-primary)]">
                {formatPrice(room.base_price)}
              </strong>
              <span className="text-xs text-[var(--text-muted)] font-medium">{t('room_per_night')}</span>
            </div>
          </div>

          <Link
            href={`/rooms/${room.type_id}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--bg-surface-elevated)] hover:bg-gradient-to-r hover:from-[var(--gold-primary)] hover:to-[var(--gold-secondary)] text-[var(--text-primary)] hover:text-white border border-[var(--border-subtle)] hover:border-transparent text-xs font-bold transition-all shadow-sm group/btn cursor-pointer"
          >
            <span>{t('room_book_now')}</span>
            <ArrowRight size={14} className="group-hover/btn:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </article>
  );
}
