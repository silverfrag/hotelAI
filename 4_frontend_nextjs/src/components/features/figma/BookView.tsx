"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomPresentation } from "@/types/room-presentation.type";
import type { PublicCoupon } from "@/types/room.type";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { useReservation } from "@/hooks/useReservation";
import { getActiveCoupons } from "@/services/booking.service";
import { formatCurrency } from "@/utils/formatCurrency";
import Link from "next/link";
import { addIsoDays } from "@/utils/businessDate";
import { CalendarPicker } from "./CalendarPicker";
import { ReservationRecoverySignIn } from "@/components/features/auth/ReservationRecoverySignIn";
import { GuestPriceExplanationCard } from "@/components/features/booking/GuestPriceExplanationCard";

type Step = 1 | 2 | 3 | 4;

interface HotelHighlight {
  id: string;
  floor: string;
  titleVi: string;
  titleEn: string;
  subVi: string;
  subEn: string;
  img: string;
}

const WHITE_SAND_HIGHLIGHTS: HotelHighlight[] = [
  {
    id: "lobby-1f",
    floor: "1F · 24/7 Reception",
    titleVi: "Lễ tân & Sảnh đón 1F",
    titleEn: "Lobby & 24/7 Concierge (1F)",
    subVi: "Đón tiếp ngay tại 89-91 Võ Văn Kiệt, Sơn Trà, Đà Nẵng",
    subEn: "Check-in & hospitality desk at 89-91 Vo Van Kiet, Son Tra",
    img: "/images/whitesand/facilities/concierge-reception.jpg",
  },
  {
    id: "pool-gym-2f",
    floor: "2F · Wellness",
    titleVi: "Hồ bơi & Phòng Gym 2F",
    titleEn: "Pool & Fitness (2F)",
    subVi: "Miễn phí cho khách lưu trú mọi hạng phòng",
    subEn: "Complimentary access for all registered guests",
    img: "/images/whitesand/facilities/pool-gym-2f.jpg",
  },
  {
    id: "restaurant-14f",
    floor: "14F · Dining",
    titleVi: "Nhà hàng tầm nhìn biển 14F",
    titleEn: "Seaview Restaurant (14F)",
    subVi: "Buffet sáng và ẩm thực địa phương Đà Nẵng",
    subEn: "Breakfast buffet & coastal dining on the 14th floor",
    img: "/images/whitesand/facilities/restaurant-14f.jpg",
  },
  {
    id: "spa-15f",
    floor: "15F · Spa",
    titleVi: "White Sand Spa 15F",
    titleEn: "White Sand Spa (15F)",
    subVi: "Liệu trình thư giãn trên tầng cao nhất tòa nhà",
    subEn: "Rooftop relaxation suites overlooking My Khe",
    img: "/images/whitesand/facilities/spa-15f.jpg",
  },
];

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 6l3 3L10 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6.5h9M8 3l3.5 3.5L8 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type InitialBooking = {
  room_type_id?: string;
  check_in_date?: string;
  check_out_date?: string;
  guest_count?: string;
  total_of_special_requests?: string;
  coupon_code?: string;
  step?: string;
};

export default function BookView({
  rooms,
  businessDate,
  initial = {},
}: {
  rooms: RoomPresentation[];
  businessDate: string;
  initial?: InitialBooking;
}) {
  const { t, lang } = useTranslation();
  const { user, ready } = useAuth();
  const [step, setStep] = useState<Step>(initial.step === "3" ? 3 : 1);
  const [selectedRoom, setSelectedRoom] = useState(
    rooms.find((r) => String(r.id) === initial.room_type_id) ?? rooms[0],
  );
  const [calendarViewRoomId, setCalendarViewRoomId] = useState<number | null>(null);
  const [checkIn, setCheckIn] = useState(initial.check_in_date || businessDate);
  const [checkOut, setCheckOut] = useState(initial.check_out_date || addIsoDays(businessDate, 5));
  const [guests, setGuests] = useState(Math.max(1, Math.min(20, Number(initial.guest_count) || 2)));
  const [requests, setRequests] = useState(
    Math.max(0, Math.min(5, Math.trunc(Number(initial.total_of_special_requests) || 0))),
  );
  const normalizedInitialCoupon = (initial.coupon_code ?? "").trim().toUpperCase();
  const [couponInput, setCouponInput] = useState(normalizedInitialCoupon);
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(normalizedInitialCoupon || null);
  const [couponHint, setCouponHint] = useState("");
  const [availableCoupons, setAvailableCoupons] = useState<PublicCoupon[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void getActiveCoupons(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setAvailableCoupons(list);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const STEPS = [
    { n: 1, label: t("book_step_1") },
    { n: 2, label: t("book_step_2") },
    { n: 3, label: t("book_step_3") },
    { n: 4, label: t("book_step_4") },
  ];

  const validDates =
    /^\d{4}-\d{2}-\d{2}$/.test(checkIn) &&
    /^\d{4}-\d{2}-\d{2}$/.test(checkOut) &&
    Number.isFinite(Date.parse(checkIn)) &&
    Number.isFinite(Date.parse(checkOut)) &&
    new Date(checkIn).toISOString().slice(0, 10) === checkIn &&
    new Date(checkOut).toISOString().slice(0, 10) === checkOut &&
    checkIn >= businessDate &&
    checkOut > checkIn;

  const nights = validDates ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000) : 0;
  const input =
    selectedRoom &&
    validDates &&
    guests >= 1 &&
    guests <= selectedRoom.guests &&
    Number.isInteger(guests) &&
    requests >= 0 &&
    requests <= 5 &&
    Number.isInteger(requests)
      ? {
          room_type_id: selectedRoom.id,
          check_in_date: checkIn,
          check_out_date: checkOut,
          guest_count: guests,
          total_of_special_requests: requests,
          ...(appliedCoupon ? { coupon_code: appliedCoupon } : {}),
        }
      : null;

  const reservation = useReservation(input);
  const { quote, result, loading, quoteError, expired, submitting, retryOnly, recoveryAccount, recoveryNeedsSignIn, markQuoteVisible } =
    reservation;
  const priceSummaryRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = priceSummaryRef.current;
    const quoteId = quote?.quote_id;
    if (!element || !quoteId || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
          markQuoteVisible(quoteId);
        } else {
          markQuoteVisible((prev) => (prev === quoteId ? null : prev));
        }
      },
      { threshold: [0.5] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [quote?.quote_id, markQuoteVisible]);
  const submitted = !!result;

  const roomTotal = (selectedRoom?.price ?? 0) * nights;
  const nightlyPrice = result?.nightly_price ?? quote?.nightly_price ?? selectedRoom?.price ?? 0;
  const preCouponNightly = quote?.pricing_breakdown?.pre_coupon_nightly_price ?? nightlyPrice;
  const grandTotal = result?.total_price ?? quote?.total_price ?? roomTotal;
  const preCouponTotal =
    result?.pre_coupon_total_price ??
    quote?.pre_coupon_total_price ??
    quote?.pricing_breakdown?.pre_coupon_total_price ??
    grandTotal;
  const couponDiscountVnd =
    result?.coupon_discount_vnd ??
    quote?.coupon_discount_vnd ??
    quote?.pricing_breakdown?.coupon_discount_total_vnd ??
    0;
  const isFloorClamped = Boolean(
    result?.is_floor_price_clamped ??
      quote?.is_floor_price_clamped ??
      quote?.pricing_breakdown?.is_floor_price_clamped,
  );
  const isCeilingClamped = Boolean(quote?.pricing_breakdown?.is_ceiling_clamped);
  const floorPriceVnd = quote?.pricing_breakdown?.floor_price_vnd ?? 452_000;

  const returnParams = new URLSearchParams({
    room_type_id: String(selectedRoom?.id ?? ""),
    check_in_date: checkIn,
    check_out_date: checkOut,
    guest_count: String(guests),
    total_of_special_requests: String(requests),
    step: "3",
  });
  if (appliedCoupon) returnParams.set("coupon_code", appliedCoupon);
  const returnUrl = `/book?${returnParams.toString()}`;

  const applyCoupon = (rawCode: string) => {
    if (submitting || retryOnly || submitted) return;
    const code = rawCode.trim().toUpperCase();
    setCouponHint("");
    if (!code) {
      reservation.changeSelection();
      setAppliedCoupon(null);
      setCouponInput("");
      return;
    }
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      setCouponHint(
        lang === "vi"
          ? "Mã ưu đãi chỉ gồm 3–32 ký tự chữ in hoa, số, '-' hoặc '_'."
          : "Coupon code must be 3–32 uppercase alphanumeric characters, '-' or '_'.",
      );
      return;
    }
    reservation.changeSelection();
    setCouponInput(code);
    setAppliedCoupon(code);
  };

  const clearCoupon = () => {
    if (submitting || retryOnly || submitted) return;
    reservation.changeSelection();
    setCouponInput("");
    setAppliedCoupon(null);
    setCouponHint("");
  };

  const goNext = () => {
    if (submitting || result || retryOnly) return;
    if (!validDates) {
      setError(t("rooms_checkin_label") + " / " + t("rooms_checkout_label"));
      return;
    }
    if (step >= 2 && !input) {
      setError(t("rooms_capacity_any"));
      return;
    }
    if (step === 3 && !user) {
      setError(t("book_step3_signin_notice"));
      return;
    }
    setError("");
    setStep((value) => Math.min(4, value + 1) as Step);
  };

  const goBack = () => {
    if (submitting || result || retryOnly) return;
    setError("");
    setStep((value) => Math.max(1, value - 1) as Step);
  };

  const handleSubmit = () => {
    void reservation.confirm();
  };

  if (!selectedRoom) {
    return (
      <section className="px-5 md:px-16 pt-32 pb-24">
        <h1 className="font-display text-4xl mb-4">{t("book_title")}</h1>
        <p>{t("rooms_empty")}</p>
        <Link href="/rooms" className="inline-block mt-6 underline">
          {t("rooms_view_all")}
        </Link>
      </section>
    );
  }

  return (
    <>
      {/* ── HEADER ── */}
      <section className="pt-24 pb-10 px-5 md:px-10 lg:px-16" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px w-8" style={{ background: "var(--gold)" }} />
          <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
            {t("book_eyebrow")}
          </span>
        </div>
        <h1 className="font-display text-4xl md:text-5xl" style={{ color: "var(--fg)" }}>
          {t("book_title")}
        </h1>

        {/* progress indicator */}
        <div className="flex items-center gap-0 mt-10 max-w-lg">
          {STEPS.map((s, i) => {
            const done = step > s.n;
            const active = step === s.n;
            return (
              <div key={s.n} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 text-[11px] font-medium"
                    style={{
                      background: done
                        ? "var(--gold)"
                        : active
                          ? "rgba(196,153,90,0.15)"
                          : "transparent",
                      border: `1px solid ${done || active ? "var(--gold)" : "var(--border-gold)"}`,
                      color: done ? "var(--bg)" : active ? "var(--gold)" : "var(--dim)",
                    }}
                  >
                    {done ? <CheckIcon /> : s.n}
                  </div>
                  <span
                    className="text-[9px] tracking-[0.12em] uppercase mt-1.5"
                    style={{ color: active ? "var(--gold)" : "var(--dim)" }}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className="flex-1 h-px mx-2 mb-5 transition-all duration-300"
                    style={{ background: done ? "var(--gold)" : "var(--border-gold)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── MAIN LAYOUT ── */}
      <div className="flex flex-col lg:flex-row min-h-[70vh]">
        {/* left: step content */}
        <div className="flex-1 px-5 md:px-10 lg:px-16 py-12">
          {/* STEP 1: Dates & White Sand Overview */}
          {step === 1 && (
            <div>
              <h2 className="font-display text-3xl mb-2" style={{ color: "var(--fg)" }}>
                {t("book_step1_title")}
              </h2>
              <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
                {t("book_step1_desc")}
              </p>

              {/* dates */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8 p-6" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                <div>
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    {t("book_checkin_label")}
                  </label>
                  <input
                    type="date"
                    aria-label="Check in"
                    min={businessDate}
                    required
                    value={checkIn}
                    onChange={(e) => {
                      if (e.target.value !== checkIn && !submitting && !retryOnly) {
                        reservation.changeSelection();
                        setCheckIn(e.target.value);
                      }
                    }}
                    className="w-full bg-transparent text-sm outline-none pb-2 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid var(--border-gold)", color: "var(--fg)" }}
                  />
                </div>
                <div>
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    {t("book_checkout_label")}
                  </label>
                  <input
                    type="date"
                    aria-label="Check out"
                    min={
                      /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && Number.isFinite(Date.parse(checkIn))
                        ? addIsoDays(checkIn, 1)
                        : businessDate
                    }
                    required
                    value={checkOut}
                    onChange={(e) => {
                      if (e.target.value !== checkOut && !submitting && !retryOnly) {
                        reservation.changeSelection();
                        setCheckOut(e.target.value);
                      }
                    }}
                    className="w-full bg-transparent text-sm outline-none pb-2 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid var(--border-gold)", color: "var(--fg)" }}
                  />
                </div>
                <div>
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    {t("book_guests_label")}
                  </label>
                  <div className="flex items-center gap-3 pb-2" style={{ borderBottom: "1px solid var(--border-gold)" }}>
                    <button
                      type="button"
                      aria-label="Fewer guests"
                      disabled={guests <= 1 || submitting || retryOnly}
                      onClick={() => {
                        reservation.changeSelection();
                        setGuests((g) => Math.max(1, g - 1));
                      }}
                      className="text-lg leading-none"
                      style={{ color: "var(--gold)" }}
                    >
                      −
                    </button>
                    <span className="text-sm tabular-nums" style={{ color: "var(--fg)" }}>
                      {guests}
                    </span>
                    <button
                      type="button"
                      aria-label="More guests"
                      disabled={guests >= 20 || submitting || retryOnly}
                      onClick={() => {
                        reservation.changeSelection();
                        setGuests((g) => Math.min(20, g + 1));
                      }}
                      className="text-lg leading-none"
                      style={{ color: "var(--gold)" }}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* White Sand Boutique Hotel Facility Overview (Informational only) */}
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] tracking-[0.18em] uppercase" style={{ color: "var(--gold)" }}>
                  White Sand Boutique Hotel · 89-91 Võ Văn Kiệt, Sơn Trà, TP. Đà Nẵng
                </span>
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                  15 tầng · 54 phòng · 6 hạng phòng
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {WHITE_SAND_HIGHLIGHTS.map((item) => (
                  <div
                    key={item.id}
                    className="flex gap-4 p-4"
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg2)",
                    }}
                  >
                    <div className="w-20 h-16 overflow-hidden shrink-0 rounded-sm">
                      <img
                        src={item.img}
                        alt={lang === "vi" ? item.titleVi : item.titleEn}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] tracking-widest uppercase mb-0.5" style={{ color: "var(--gold)" }}>
                        {item.floor}
                      </div>
                      <div className="font-display text-base" style={{ color: "var(--fg)" }}>
                        {lang === "vi" ? item.titleVi : item.titleEn}
                      </div>
                      <div className="text-[11px] mt-1 leading-snug" style={{ color: "var(--muted)" }}>
                        {lang === "vi" ? item.subVi : item.subEn}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: Choose room */}
          {step === 2 && (
            <div>
              <div className="flex flex-wrap justify-between items-end gap-4 mb-8">
                <div>
                  <h2 className="font-display text-3xl mb-2" style={{ color: "var(--fg)" }}>
                    {t("book_step2_title")}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {nights} {t("book_nights")} · {checkIn} → {checkOut} · White Sand Boutique Hotel Đà Nẵng
                  </p>
                </div>
                <p className="text-xs max-w-sm" style={{ color: "var(--muted)" }}>
                  {lang === "vi"
                    ? "Mỗi mã đặt phòng dành cho một phòng. Nếu cần thêm phòng, hãy tạo đặt phòng tiếp theo."
                    : "Each reservation covers one room. Create another reservation if you need additional rooms."}
                </p>
              </div>

              <div className="flex flex-col gap-4">
                {rooms.map((room) => {
                  const sel = selectedRoom?.id === room.id;

                  return (
                    <div
                      key={room.id}
                      className="flex flex-col gap-4 p-4 border transition-all duration-200"
                      style={{
                        borderColor: sel ? "var(--gold)" : "var(--border)",
                        background: sel ? "rgba(196,153,90,0.05)" : "var(--bg2)",
                      }}
                    >
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="sm:w-36 h-28 sm:h-auto shrink-0 overflow-hidden">
                          <img src={room.img} alt={room.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 flex flex-col justify-center">
                          <div className="text-[9px] tracking-widest uppercase mb-1" style={{ color: "var(--gold)" }}>
                            {room.category}{room.floor ? ` · ${room.floor}` : ""}
                          </div>
                          <div className="font-display text-lg mb-1">{room.name}</div>
                          <div className="text-[11px] text-[var(--muted)]">
                            {room.guests} {t("rooms_max_guests")}
                            {room.sqm ? ` · ${room.sqm} m²` : ""}
                          </div>
                        </div>
                        <div className="flex flex-col justify-center sm:items-end gap-2">
                          <div className="text-lg font-medium">
                            {formatCurrency(room.price)}{" "}
                            <span className="text-[10px] text-[var(--muted)]">{t("rooms_per_night")}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCalendarViewRoomId(calendarViewRoomId === room.id ? null : room.id)}
                            className="text-[10px] underline text-[var(--gold)] text-left sm:text-right"
                          >
                            {t("book_view_calendar")}
                          </button>
                          <button
                            type="button"
                            aria-pressed={sel}
                            disabled={submitting || retryOnly || submitted}
                            onClick={() => {
                              reservation.changeSelection();
                              setSelectedRoom(room);
                              setGuests((value) => Math.min(value, room.guests));
                            }}
                            className="mt-2 px-3 py-2 bg-[var(--gold)] text-[var(--bg)] text-xs font-medium"
                          >
                            {sel ? (lang === "vi" ? "Đã chọn" : "Selected") : lang === "vi" ? "Chọn phòng" : "Select room"}
                          </button>
                        </div>
                      </div>

                      {calendarViewRoomId === room.id && (
                        <div className="mt-4 p-4 border border-[var(--border-gold)]">
                          <CalendarPicker
                            roomTypeId={room.id}
                            businessDate={businessDate}
                            initialCheckIn={checkIn}
                            initialCheckOut={checkOut}
                            onDatesChange={(cin, cout) => {
                              if (submitting || retryOnly || submitted) return;
                              reservation.changeSelection();
                              setCheckIn(cin);
                              setCheckOut(cout);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: Guest details */}
          {step === 3 && (
            <div>
              <h2 className="font-display text-3xl mb-2">{t("book_step3_title")}</h2>
              <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
                {t("book_step3_desc")}
              </p>
              {!ready ? (
                <p role="status">Checking account…</p>
              ) : !user ? (
                <div className="p-6 max-w-xl" style={{ border: "1px solid var(--border-gold)", background: "var(--bg2)" }}>
                  <p className="text-sm mb-6">{t("book_step3_signin_notice")}</p>
                  <Link
                    href={`/login?next=${encodeURIComponent(returnUrl)}`}
                    className="inline-block px-6 py-3 text-xs mr-4"
                    style={{ background: "var(--gold)", color: "var(--bg)" }}
                  >
                    {t("nav_login")}
                  </Link>
                  <Link href={`/register?next=${encodeURIComponent(returnUrl)}`} className="text-xs underline">
                    {t("nav_register")}
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
                  {[
                    { label: t("book_guest_name"), value: user.full_name },
                    { label: t("book_email"), value: user.email },
                    { label: t("book_phone"), value: user.phone ?? t("book_not_provided") },
                    { label: t("book_country"), value: user.nationality ?? t("book_not_provided") },
                  ].map((field) => (
                    <div key={field.label}>
                      <p className="text-[9px] tracking-[.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                        {field.label}
                      </p>
                      <p className="text-sm pb-2 break-words" style={{ borderBottom: "1px solid var(--border-gold)" }}>
                        {field.value}
                      </p>
                    </div>
                  ))}
                  <Link href="/profile" className="text-xs underline text-[var(--gold)]">
                    {t("book_update_profile")}
                  </Link>
                </div>
              )}
              <div className="mt-8 max-w-sm">
                <label
                  htmlFor="booking-request-count"
                  className="block text-[9px] tracking-[.2em] uppercase mb-2"
                  style={{ color: "var(--gold)" }}
                >
                  {t("book_special_requests")}
                </label>
                <input
                  id="booking-request-count"
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  value={requests}
                  onChange={(event) => {
                    if (requests !== Number(event.target.value) && !submitting && !retryOnly) {
                      reservation.changeSelection();
                      setRequests(Number(event.target.value));
                    }
                  }}
                  className="w-24 p-3 bg-transparent"
                  style={{ border: "1px solid var(--border-gold)" }}
                />
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  {t("book_special_requests_desc")}
                </p>
              </div>

              <p className="mt-8 text-xs max-w-xl" style={{ color: "var(--muted)" }}>
                {lang === "vi"
                  ? "Giá này chỉ bao gồm phòng. Dịch vụ spa, xe đưa đón hoặc ăn uống cần được khách sạn xác nhận riêng."
                  : "This quote covers the room. Spa, transfers and dining require separate confirmation from the hotel."}
              </p>
            </div>
          )}

          {/* STEP 4: Confirmation */}
          {step === 4 && (
            <div>
              {result ? (
                <div className="py-10 max-w-lg" role="status">
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center mb-8"
                    style={{ border: "1px solid var(--gold)", color: "var(--gold)" }}
                  >
                    <CheckIcon />
                  </div>
                  <h2 className="font-display text-4xl mb-4">
                    {result.booking.status === "Confirmed"
                      ? t("book_confirmed_title")
                      : result.booking.status === "Pending"
                        ? t("book_pending_title")
                        : `${t("book_summary_title")}: ${result.booking.status}`}
                  </h2>
                  <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
                    {t("book_saved_notice")}
                  </p>
                  {result.booking.status === "Pending" && (
                    <p className="text-sm mb-6" style={{ color: "var(--gold)" }}>
                      {lang === "vi" ? "Tiền cọc yêu cầu: " : "Deposit: "}
                      {formatCurrency(result.booking.deposit_required)}.{" "}
                      {lang === "vi" ? "Thời hạn giữ phòng đến: " : "Hold expires: "}
                      {result.booking.pending_expires_at
                        ? new Date(result.booking.pending_expires_at).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB", {
                            timeZone: "Asia/Ho_Chi_Minh",
                            dateStyle: "short",
                            timeStyle: "medium",
                          }) + (lang === "vi" ? " (Giờ Việt Nam)" : " (Vietnam Time)")
                        : t("book_view_history")}
                    </p>
                  )}
                  <div className="p-5 mb-6" style={{ border: "1px solid var(--border-gold)", background: "var(--bg2)" }}>
                    <p className="text-[9px] tracking-[.2em] uppercase mb-3">{t("book_ref_code")}</p>
                    <p className="font-display text-xl break-all">{result.booking.booking_id}</p>
                    <p className="text-xs mt-3">
                      {t("book_rooms_label")} {result.room_number} · {selectedRoom.name} · {nights} {t("book_nights")}
                    </p>
                    {result.coupon_code && (result.coupon_discount_vnd ?? 0) > 0 && (
                      <p className="text-xs mt-1 text-purple-300">
                        Coupon {result.coupon_code}: -{formatCurrency(result.coupon_discount_vnd ?? 0)}
                      </p>
                    )}
                    <p className="mt-3 text-sm">
                      {t("book_total")} {formatCurrency(result.total_price ?? result.applied_price)} · Payment:{" "}
                      {result.payment_status}
                    </p>
                  </div>
                  <Link
                    href="/bookings"
                    className="inline-block px-6 py-3 text-xs"
                    style={{ background: "var(--gold)", color: "var(--bg)" }}
                  >
                    {t("book_view_history")}
                  </Link>
                </div>
              ) : (
                <div>
                  <h2 className="font-display text-3xl mb-2" style={{ color: "var(--fg)" }}>
                    {t("book_step4_title")}
                  </h2>
                  <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
                    {t("book_step4_desc")}
                  </p>

                  <div className="space-y-4 max-w-xl">
                    {[
                      {
                        label: lang === "vi" ? "Khách sạn" : "Hotel",
                        value: "White Sand Boutique Hotel · 89-91 Võ Văn Kiệt, Sơn Trà, Đà Nẵng",
                      },
                      { label: t("book_rooms_label"), value: selectedRoom.name },
                      { label: t("book_checkin_label"), value: checkIn },
                      { label: t("book_checkout_label"), value: checkOut },
                      { label: t("book_duration_label"), value: `${nights} ${t("book_nights")}` },
                      { label: t("book_guests_label"), value: String(guests) },
                      ...(quote?.coupon_code
                        ? [
                            {
                              label: lang === "vi" ? "Mã ưu đãi" : "Coupon",
                              value: `${quote.coupon_code} (-${formatCurrency(couponDiscountVnd)})`,
                            },
                          ]
                        : []),
                      { label: t("book_guest_name"), value: user?.full_name ?? "—" },
                      { label: t("book_email"), value: user?.email ?? "—" },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                        <span className="text-[10px] tracking-[0.12em] uppercase" style={{ color: "var(--muted)" }}>
                          {row.label}
                        </span>
                        <span className="text-[11px] font-medium text-right" style={{ color: "var(--fg)" }}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between py-4">
                      <span className="text-[10px] tracking-[0.12em] uppercase" style={{ color: "var(--gold)" }}>
                        {t("book_total")}
                      </span>
                      <div className="text-right">
                        {couponDiscountVnd > 0 && preCouponTotal > grandTotal && (
                          <div className="text-xs line-through" style={{ color: "var(--muted)" }}>
                            {formatCurrency(preCouponTotal)}
                          </div>
                        )}
                        <span className="font-display text-xl" style={{ color: "var(--gold)" }}>
                          {formatCurrency(grandTotal)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] mt-6 max-w-md" style={{ color: "var(--dim)" }}>
                    {t("book_confirmation_notice")}
                  </p>
                </div>
              )}
            </div>
          )}

          {(error || reservation.error) && (
            <p role="alert" className="mt-6 text-sm text-red-400">
              {error || reservation.error}
            </p>
          )}
          {step === 4 && recoveryNeedsSignIn && recoveryAccount && (
            <ReservationRecoverySignIn account={recoveryAccount} />
          )}
          {retryOnly && !result && (
            <p role="status" className="mt-4 text-xs">
              Keep this page open to recover the existing request. Check{" "}
              <Link href="/bookings" target="_blank" rel="noopener noreferrer" className="underline">
                My bookings in another tab
              </Link>{" "}
              before leaving or reloading.
            </p>
          )}

          {/* navigation buttons */}
          {!submitted && (
            <div className="flex items-center gap-4 mt-12">
              {step > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={submitting || retryOnly}
                  className="text-[10px] tracking-[0.16em] uppercase px-8 py-3 transition-all duration-200"
                  style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}
                >
                  {t("book_back")}
                </button>
              )}
              {step < 4 ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={submitting || retryOnly}
                  className="text-[10px] tracking-[0.16em] uppercase px-10 py-3 font-medium flex items-center gap-2 transition-all duration-200"
                  style={{ background: "var(--gold)", color: "var(--bg)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
                >
                  {t("book_continue")} <ArrowRight />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={
                    !user ||
                    recoveryNeedsSignIn ||
                    !quote ||
                    loading ||
                    (!retryOnly && expired) ||
                    submitting ||
                    (!retryOnly && quote.rooms_available < 1)
                  }
                  className="text-[10px] tracking-[0.16em] uppercase px-10 py-3 font-medium flex items-center gap-2 transition-all duration-200"
                  style={{ background: "var(--gold)", color: "var(--bg)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
                >
                  {submitting ? t("book_saving") : retryOnly ? "Recover reservation" : t("book_confirm_btn")}{" "}
                  <ArrowRight />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── ORDER SUMMARY SIDEBAR ── */}
        <div
          className="w-full lg:w-[340px] shrink-0"
          style={{ borderLeft: "1px solid var(--border)", background: "var(--bg2)" }}
        >
          <div className="lg:sticky lg:top-[60px] lg:max-h-[calc(100vh-70px)] lg:overflow-y-auto p-6 pb-24" style={{ scrollbarWidth: "none" }}>
            <div className="text-[9px] tracking-[0.25em] uppercase mb-5" style={{ color: "var(--gold)" }}>
              {t("book_summary_title")}
            </div>

            {/* Room preview thumb */}
            <div className="aspect-[16/9] overflow-hidden mb-4 rounded-sm">
              <img
                src={selectedRoom.img}
                alt={`${selectedRoom.name} - White Sand Boutique Hotel`}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="font-display text-lg mb-0.5" style={{ color: "var(--fg)" }}>
              {selectedRoom.name}
            </div>
            <div className="text-[10px] mb-5" style={{ color: "var(--muted)" }}>
              {t("book_guests_label")}: {guests} · {nights} {t("book_nights")}
            </div>

            <div className="h-px mb-5" style={{ background: "var(--border)" }} />

            {/* Coupon Input & DB Quick Picks — Outside quote conditional for easy error recovery */}
            <div className="mb-5 space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="uppercase tracking-[0.12em] text-[9px] font-semibold" style={{ color: "var(--gold)" }}>
                  {lang === "vi" ? "Mã ưu đãi / Coupon" : "Promo Coupon"}
                </span>
                {(appliedCoupon || couponInput) && !submitted && !submitting && !retryOnly && (
                  <button type="button" onClick={clearCoupon} className="text-[10px] text-rose-400 hover:underline">
                    {lang === "vi" ? "Gỡ mã ưu đãi" : "Remove coupon"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="WHITESAND10..."
                  value={couponInput}
                  disabled={submitted || submitting || retryOnly}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyCoupon(couponInput);
                    }
                  }}
                  className="flex-1 px-2.5 py-1.5 text-xs uppercase font-mono bg-transparent"
                  style={{ border: "1px solid var(--border-gold)", color: "var(--fg)" }}
                />
                <button
                  type="button"
                  disabled={submitted || submitting || retryOnly}
                  onClick={() => applyCoupon(couponInput)}
                  className="px-3 py-1.5 text-[10px] tracking-[0.1em] uppercase font-medium"
                  style={{ background: "var(--gold)", color: "var(--bg)" }}
                >
                  {lang === "vi" ? "Áp dụng" : "Apply"}
                </button>
              </div>
              {availableCoupons.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {availableCoupons.map((c) => {
                    const isActive = appliedCoupon === c.code;
                    const ineligible = selectedRoom.id < c.min_room_type_id;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        disabled={submitted || submitting || retryOnly}
                        onClick={() => applyCoupon(c.code)}
                        title={c.description_vi}
                        className="px-2 py-0.5 text-[10px] font-mono border transition"
                        style={{
                          borderColor: isActive ? "var(--gold)" : "var(--border)",
                          background: isActive ? "rgba(196,153,90,0.16)" : "transparent",
                          color: ineligible && !isActive ? "var(--dim)" : "var(--fg)",
                        }}
                      >
                        {c.code} (-{Math.round(c.discount_pct * 100)}%)
                      </button>
                    );
                  })}
                </div>
              )}
              {couponHint && <p className="text-[10px] text-rose-400">{couponHint}</p>}
            </div>

            <div className="h-px mb-5" style={{ background: "var(--border)" }} />

            <div ref={priceSummaryRef}>
            {/* price breakdown */}
            <div className="space-y-2.5 mb-5 text-[11px]">
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>
                  {formatCurrency(preCouponNightly)} × {nights}n
                </span>
                <span style={{ color: "var(--fg)" }}>{formatCurrency(preCouponTotal)}</span>
              </div>
              {couponDiscountVnd > 0 && (
                <div className="flex justify-between text-purple-300">
                  <span>{lang === "vi" ? `Ưu đãi (${quote?.coupon_code ?? appliedCoupon})` : `Coupon (${quote?.coupon_code ?? appliedCoupon})`}</span>
                  <span>-{formatCurrency(couponDiscountVnd)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>{t("book_pricing_type")}</span>
                <span style={{ color: "var(--fg)" }}>
                  {quote
                    ? quote.pricing_source === "ai"
                      ? t("book_pricing_ai")
                      : t("book_pricing_base")
                    : t("book_pricing_base")}
                </span>
              </div>
              {isCeilingClamped && (
                <div className="text-[10px] text-amber-300">
                  {lang === "vi" ? "Đã áp dụng trần giá kê khai" : "Declared ceiling applied"}
                </div>
              )}
              {isFloorClamped && (
                <div className="text-[10px] text-rose-300">
                  {lang === "vi"
                    ? `Bảo vệ sàn biến phí tối thiểu (${formatCurrency(floorPriceVnd)}/đêm)`
                    : `Contribution floor applied (${formatCurrency(floorPriceVnd)}/night)`}
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>{t("book_availability_label")}</span>
                <span style={{ color: "var(--fg)" }}>
                  {quote ? `${quote.rooms_available} ${t("rooms_available_now")}` : t("rooms_check_final_btn")}
                </span>
              </div>
            </div>

            {quote && (
              <div className="mb-5">
                <GuestPriceExplanationCard
                  quote={quote}
                  basePrice={selectedRoom?.price}
                  checkInDate={checkIn}
                  checkOutDate={checkOut}
                  guestCount={guests}
                />
              </div>
            )}
            <div className="h-px mb-5" style={{ background: "var(--border)" }} />
            <div className="flex justify-between">
              <span className="text-[11px] font-medium" style={{ color: "var(--fg)" }}>
                {t("book_total")}
              </span>
              <div className="text-right">
                {couponDiscountVnd > 0 && preCouponTotal > grandTotal && (
                  <div className="text-[11px] line-through" style={{ color: "var(--muted)" }}>
                    {formatCurrency(preCouponTotal)}
                  </div>
                )}
                <div className="font-display text-2xl" style={{ color: "var(--gold)" }}>
                  {formatCurrency(grandTotal)}
                </div>
                <div className="text-[9px]" style={{ color: "var(--dim)" }}>
                  {quote ? "hotel quote · VND" : "base estimate · VND"}
                </div>
              </div>
            </div>

            <div className="mt-5 text-xs leading-relaxed" aria-live="polite" style={{ color: "var(--muted)" }}>
              {loading ? (
                <p role="status">{t("book_checking_price")}</p>
              ) : quoteError ? (
                <div role="alert" className="space-y-2">
                  <p className="text-rose-400">{quoteError}</p>
                  {appliedCoupon && !submitted && (
                    <button type="button" onClick={clearCoupon} className="text-[11px] underline text-rose-300">
                      {lang === "vi" ? `Gỡ mã ${appliedCoupon} và tính lại` : `Remove ${appliedCoupon} and retry`}
                    </button>
                  )}
                </div>
              ) : expired ? (
                <p role="alert">This quote has expired.</p>
              ) : quote ? (
                <>
                  <p>
                    {lang === "vi" ? "Giá chốt" : "Final price"}: {formatCurrency(quote.total_price)}
                  </p>
                  <p>
                    {lang === "vi" ? "Thời hạn giữ giá đến " : "Valid until "}
                    {new Date(quote.price_guaranteed_until).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", {
                      timeZone: "Asia/Ho_Chi_Minh",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}{" "}
                    ({lang === "vi" ? "Giờ Việt Nam" : "Vietnam Time"}).{" "}
                    {lang === "vi"
                      ? "Phòng chỉ được giữ sau khi hoàn tất đặt phòng."
                      : "Rooms are subject to availability until reserved."}
                  </p>
                </>
              ) : (
                <p>Select valid dates and a room that fits your party.</p>
              )}
              {!submitted && (
                <button
                  type="button"
                  disabled={loading || submitting || retryOnly || !input}
                  onClick={reservation.refreshQuote}
                  className="mt-3 underline"
                  style={{ color: "var(--gold)" }}
                >
                  {t("book_refresh_price")}
                </button>
              )}
            </div>
            </div>
            <div
              className="mt-6 p-4"
              style={{ background: "rgba(196,153,90,0.06)", border: "1px solid var(--border-gold)" }}
            >
              <div className="text-[9px] tracking-[0.18em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                {t("book_features_title")}
              </div>
              {[t("book_feat_1"), t("book_feat_2"), t("book_feat_3"), t("book_feat_4")].map((item) => (
                <div key={item} className="flex items-center gap-2 py-1.5">
                  <span style={{ color: "var(--gold)" }}>
                    <CheckIcon />
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
