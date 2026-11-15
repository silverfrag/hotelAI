'use client';

import React, { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flame,
  Info,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { formatCurrency } from '@/utils/formatCurrency';
import type { PriceQuote, PricingFactorItem } from '@/types/room.type';

interface GuestPriceExplanationCardProps {
  quote: PriceQuote | null;
  basePrice?: number;
  checkInDate?: string;
  checkOutDate?: string;
  guestCount?: number;
  className?: string;
}

const SOURCE_BADGES: Record<
  PricingFactorItem['source_category'],
  { label: string; badgeClass: string }
> = {
  '(A) ML_REAL_DATA': {
    label: '(A) ML Thật',
    badgeClass: 'bg-purple-500/20 text-purple-200 border-purple-500/35',
  },
  '(B) SIMULATED_SYSTEM_STATE': {
    label: '(B) Tồn kho',
    badgeClass: 'bg-sky-500/20 text-sky-200 border-sky-500/35',
  },
  '(C) SIMULATED_ASSUMPTION': {
    label: '(C) Giả định',
    badgeClass: 'bg-amber-500/20 text-amber-200 border-amber-500/35',
  },
  '(D) BUSINESS_RULE': {
    label: '(D) Quy tắc',
    badgeClass: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/35',
  },
};

function countUtcWeekendNights(checkInDate?: string, checkOutDate?: string): {
  stayNights: number;
  weekendNights: number;
} {
  if (!checkInDate || !checkOutDate) return { stayNights: 1, weekendNights: 0 };
  const start = Date.parse(`${checkInDate}T00:00:00Z`);
  const end = Date.parse(`${checkOutDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { stayNights: 1, weekendNights: 0 };
  }
  const stayNights = Math.max(1, Math.round((end - start) / 86_400_000));
  let weekendNights = 0;
  for (let offset = 0; offset < stayNights; offset += 1) {
    const weekday = new Date(start + offset * 86_400_000).getUTCDay();
    if (weekday === 0 || weekday === 6) weekendNights += 1;
  }
  return { stayNights, weekendNights };
}

function formatSignedPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
}

export function GuestPriceExplanationCard({
  quote,
  basePrice,
  checkInDate,
  checkOutDate,
  guestCount = 2,
  className = '',
}: GuestPriceExplanationCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (!quote) return null;

  const breakdown = quote.pricing_breakdown ?? null;
  const factors = breakdown?.factors ?? [];
  const isAi = quote.pricing_source === 'ai';
  const effectiveBase = Number(
    breakdown?.base_price ?? basePrice ?? quote.room_type?.base_price ?? quote.nightly_price,
  );
  const preCouponNightly = Number(
    breakdown?.pre_coupon_nightly_price ?? quote.nightly_price,
  );
  const effectiveCouponCode = quote.coupon_code ?? breakdown?.coupon_code ?? null;
  const effectiveCouponDiscountTotal = Number(
    quote.coupon_discount_vnd ?? breakdown?.coupon_discount_total_vnd ?? 0,
  );
  const isCeilingClamped = Boolean(breakdown?.is_ceiling_clamped);
  const isFloorClamped = Boolean(
    quote.is_floor_price_clamped ?? breakdown?.is_floor_price_clamped,
  );
  const floorPriceVnd = Number(breakdown?.floor_price_vnd ?? 452_000);
  const declaredMaxPrice =
    breakdown?.declared_max_price ?? quote.room_type?.declared_max_price ?? null;

  const netDiffPerNight = Number(quote.nightly_price) - effectiveBase;
  const absDiffPerNight = Math.abs(netDiffPerNight);
  const diffPct = effectiveBase > 0
    ? Math.round((Math.abs(netDiffPerNight) / effectiveBase) * 1000) / 10
    : 0;

  const isDiscount = netDiffPerNight < -100;
  const isSurge = netDiffPerNight > 100;
  const isScarce = quote.rooms_available <= 2;

  const { stayNights, weekendNights } = countUtcWeekendNights(
    checkInDate ?? quote.check_in_date,
    checkOutDate ?? quote.check_out_date,
  );
  const effectiveGuests = quote.guest_count || guestCount;
  const canExpand = isAi || factors.length > 0 || Boolean(effectiveCouponCode);

  const toneClass = isDiscount
    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100'
    : isSurge
      ? isScarce
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
        : 'border-violet-500/30 bg-violet-500/5 text-violet-100'
      : 'border-white/10 bg-slate-900/40 text-slate-200';

  return (
    <div className={`rounded-2xl border transition-all duration-300 text-xs ${toneClass} p-4 space-y-3 ${className}`}>
      {/* Header Summary */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isDiscount ? (
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <TrendingDown className="size-4" />
            </div>
          ) : isSurge ? (
            <div
              className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                isScarce ? 'bg-amber-500/20 text-amber-400' : 'bg-violet-500/20 text-violet-400'
              }`}
            >
              {isScarce ? <Flame className="size-4" /> : <TrendingUp className="size-4" />}
            </div>
          ) : (
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300">
              <CheckCircle2 className="size-4" />
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-sm text-white">
                {effectiveCouponCode && effectiveCouponDiscountTotal > 0
                  ? `Ưu đãi ${effectiveCouponCode}: tiết kiệm ${formatCurrency(effectiveCouponDiscountTotal)}`
                  : isDiscount
                    ? `Giá thấp hơn niêm yết ${diffPct}%`
                    : isSurge
                      ? isScarce
                        ? `Nhu cầu cao: còn ${quote.rooms_available} phòng trống`
                        : `Điều chỉnh theo ngữ cảnh +${diffPct}%`
                      : 'Giá tiêu chuẩn niêm yết'}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
              {isDiscount
                ? `Mức giá mỗi đêm thấp hơn giá niêm yết cơ sở ${formatCurrency(absDiffPerNight)}/đêm.`
                : isSurge
                  ? `Báo giá phản ánh công suất còn ${quote.rooms_available}/${quote.rooms_sellable} phòng bán được và ngữ cảnh ${stayNights} đêm lưu trú.`
                  : 'Áp dụng mức giá niêm yết tiêu chuẩn của White Sand Boutique Hotel Đà Nẵng.'}
            </p>
          </div>
        </div>

        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium bg-white/10 hover:bg-white/20 text-slate-200 transition-colors shrink-0 border border-white/10"
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                <span>Thu gọn</span>
                <ChevronUp className="size-3.5" />
              </>
            ) : (
              <>
                <span>Bóc tách nguồn giá</span>
                <ChevronDown className="size-3.5" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Factor Chips: Driven by real server breakdown.factors when present */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {factors.length > 0 ? (
          factors.map((factor, idx) => {
            const meta = SOURCE_BADGES[factor.source_category] ?? {
              label: factor.source_category,
              badgeClass: 'bg-white/10 text-slate-200 border-white/15',
            };
            return (
              <span
                key={`${factor.factor_name}-${idx}`}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${meta.badgeClass}`}
                title={factor.description_vi}
              >
                <span className="font-mono text-[10px] opacity-85">{meta.label}</span>
                <span>· {factor.factor_name}</span>
                {factor.impact_pct !== 0 && (
                  <span className="font-mono font-semibold">({formatSignedPct(factor.impact_pct)})</span>
                )}
              </span>
            );
          })
        ) : (
          <>
            <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-200 border border-white/10">
              <Calendar className="size-3 text-slate-400" />
              {stayNights} đêm ({weekendNights > 0 ? `${weekendNights} đêm cuối tuần` : 'ngày thường'})
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/15 px-2 py-1 text-[11px] font-medium text-sky-200 border border-sky-500/30">
              <Layers className="size-3 text-sky-300" />
              Phòng trống: {quote.rooms_available} phòng
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-200 border border-white/10">
              <Users className="size-3 text-slate-400" />
              {effectiveGuests} khách
            </span>
          </>
        )}
      </div>

      {/* Policy / Constraint Highlights */}
      {(isCeilingClamped || isFloorClamped || (effectiveCouponCode && effectiveCouponDiscountTotal > 0)) && (
        <div className="flex flex-wrap gap-1.5">
          {isCeilingClamped && declaredMaxPrice != null && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2 py-1 text-[11px] text-amber-200">
              <Info className="size-3 shrink-0" />
              Chặn trần kê khai: {formatCurrency(declaredMaxPrice)}/đêm
            </span>
          )}
          {effectiveCouponCode && effectiveCouponDiscountTotal > 0 && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-purple-500/20 border border-purple-500/35 px-2 py-1 text-[11px] text-purple-200">
              <Tag className="size-3 shrink-0" />
              Mã {effectiveCouponCode}: -{formatCurrency(effectiveCouponDiscountTotal)}
            </span>
          )}
          {isFloorClamped && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-rose-500/20 border border-rose-500/35 px-2 py-1 text-[11px] text-rose-200">
              <ShieldAlert className="size-3 shrink-0" />
              Bảo vệ giá sàn biến phí: {formatCurrency(floorPriceVnd)}/đêm
            </span>
          )}
        </div>
      )}

      {/* Expanded Transparency Drawer */}
      {expanded && canExpand && (
        <div className="mt-3 pt-3 border-t border-white/[0.08] space-y-3 animate-in fade-in duration-200">
          <p className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="size-3 text-amber-400" />
            Minh bạch thành phần & nguồn gốc định giá
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-slate-950/60 p-2.5 border border-white/[0.06] flex justify-between items-center">
              <span className="text-slate-400">Giá cơ sở hạng phòng:</span>
              <span className="font-mono font-bold text-slate-200">{formatCurrency(effectiveBase)}</span>
            </div>

            {isAi && breakdown && (
              <div className="rounded-xl bg-slate-950/60 p-2.5 border border-white/[0.06] flex justify-between items-center">
                <span className="text-slate-400">ML Benchmark (A):</span>
                <span className="font-mono font-bold text-purple-300">
                  {formatCurrency(breakdown.ml_reference_price)}
                </span>
              </div>
            )}

            <div className="rounded-xl bg-slate-950/60 p-2.5 border border-white/[0.06] flex justify-between items-center">
              <span className="text-slate-400">Giá trước ưu đãi / đêm:</span>
              <span className="font-mono font-bold text-slate-200">{formatCurrency(preCouponNightly)}</span>
            </div>

            <div className="rounded-xl bg-slate-950/60 p-2.5 border border-white/[0.06] flex justify-between items-center">
              <span className="text-slate-400">Giá chốt sau quy tắc / đêm:</span>
              <span className="font-mono font-bold text-emerald-300">
                {formatCurrency(quote.nightly_price)}
              </span>
            </div>

            {declaredMaxPrice != null && (
              <div className="rounded-xl bg-slate-950/60 p-2.5 border border-white/[0.06] flex justify-between items-center">
                <span className="text-slate-400">Giá trần kê khai:</span>
                <span className="font-mono font-medium text-amber-300">
                  {formatCurrency(declaredMaxPrice)}
                </span>
              </div>
            )}

            <div className="rounded-xl bg-slate-950/60 p-2.5 border border-white/[0.06] flex justify-between items-center">
              <span className="text-slate-400">Tồn kho thời điểm báo giá:</span>
              <span className="font-mono font-medium text-sky-300">
                {quote.rooms_available}/{quote.rooms_sellable} phòng trống
              </span>
            </div>
          </div>

          {factors.length > 0 && (
            <div className="space-y-1.5">
              {factors.map((factor, idx) => {
                const meta = SOURCE_BADGES[factor.source_category] ?? {
                  label: factor.source_category,
                  badgeClass: 'bg-white/10 text-slate-200 border-white/15',
                };
                return (
                  <div
                    key={`${factor.factor_name}-detail-${idx}`}
                    className="rounded-xl bg-slate-950/50 border border-white/[0.06] p-2.5 flex items-start justify-between gap-3"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-mono font-semibold ${meta.badgeClass}`}>
                          {meta.label}
                        </span>
                        <span className="font-semibold text-slate-100">{factor.factor_name}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">{factor.description_vi}</p>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <div
                        className={`font-bold ${
                          factor.impact_vnd > 0
                            ? 'text-amber-300'
                            : factor.impact_vnd < 0
                              ? 'text-emerald-300'
                              : 'text-slate-300'
                        }`}
                      >
                        {formatSignedPct(factor.impact_pct)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {factor.impact_vnd > 0
                          ? `+${formatCurrency(factor.impact_vnd)}`
                          : factor.impact_vnd < 0
                            ? formatCurrency(factor.impact_vnd)
                            : '0 VND'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-xl bg-black/30 p-3 border border-white/[0.04] space-y-1.5 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5 font-medium text-slate-200">
              <ShieldCheck className="size-3.5 text-emerald-400 shrink-0" />
              <span>Bảo lưu báo giá & quy tắc an toàn biên đóng góp:</span>
            </div>
            <p className="leading-relaxed text-slate-400 pl-5">
              Báo giá phân tách rõ <strong className="text-white">(A) ML dữ liệu lịch sử</strong>,{' '}
              <strong className="text-white">(B) Tồn phòng White Sand</strong>,{' '}
              <strong className="text-white">(C) Giả định mùa vụ</strong> và{' '}
              <strong className="text-white">(D) Quy tắc trần kê khai / coupon / sàn biến phí</strong>. Mức giá được
              bảo lưu trong 15 phút trước khi tạo đặt phòng.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
