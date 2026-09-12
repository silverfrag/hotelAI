"use client";

import { useState } from "react";
import Link from "next/link";
import type { RoomPresentation } from "@/types/room-presentation.type";
import { addIsoDays } from "@/utils/businessDate";
import { useTranslation } from "@/contexts/LanguageContext";

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function StarIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
      <path d="M5 0.5L6.18 3.68L9.51 3.9L6.89 6.12L7.74 9.37L5 7.6L2.26 9.37L3.11 6.12L0.49 3.9L3.82 3.68L5 0.5Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 5l2.5 2.5L8.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NIGHTS_OPTIONS = [1, 2, 3, 5, 7, 14];

export default function RoomsView({ rooms, businessDate }: { rooms: RoomPresentation[]; businessDate: string }) {
  const { t, formatPrice } = useTranslation();
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [capacity, setCapacity] = useState(0);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(rooms[0]?.id);
  const selected = rooms.find((room) => room.id === selectedId) ?? rooms[0];
  const [nights, setNights] = useState(3);
  const [checkIn, setCheckIn] = useState(businessDate);
  const [guests, setGuests] = useState(2);
  const [expanded, setExpanded] = useState<number | null>(null);

  const normalizedSearch = search.trim().toLocaleLowerCase("vi");
  const filtered = rooms.filter((room) =>
    (category === "All" || room.category === category) &&
    (!normalizedSearch || room.name.toLocaleLowerCase("vi").includes(normalizedSearch)) &&
    (capacity === 0 || room.guests >= capacity) &&
    (!availableOnly || room.availableNow > 0)
  );

  const categories = ["All", ...new Set(rooms.map((room) => room.category))];
  const checkOut = isCalendarDate(checkIn) ? addIsoDays(checkIn, nights) : "";
  const validDate = isCalendarDate(checkIn) && isCalendarDate(checkOut) && checkIn >= businessDate && checkOut > checkIn;
  const capacities = [...new Set([1, 2, 3, 4, 5, 6, ...rooms.map((room) => room.guests)])].sort((a, b) => a - b);

  if (!selected) {
    return (
      <section className="px-5 md:px-10 lg:px-16 pt-32 pb-24">
        <h1 className="font-display text-4xl mb-4">{t("rooms_title")}</h1>
        <p style={{ color: "var(--muted)" }}>{t("rooms_empty")}</p>
      </section>
    );
  }

  const guestCount = Math.min(guests, selected.guests);
  const bookingHref = validDate
    ? `/book?${new URLSearchParams({
        room_type_id: String(selected.id),
        check_in_date: checkIn,
        check_out_date: checkOut,
        guest_count: String(guestCount),
      })}`
    : "/book";
  const total = selected.price * nights;

  return (
    <>
      {/* ── MINI HERO ── */}
      <section className="relative h-[42vh] min-h-[320px] flex items-end overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-700"
          style={{ backgroundImage: `url(${selected.img})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.90)] via-[rgba(0,0,0,0.35)] to-[rgba(0,0,0,0.15)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(0,0,0,0.55)] to-transparent" />
        <div className="relative z-10 px-5 md:px-10 lg:px-16 pb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              {t("rooms_eyebrow")}
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-6xl text-white leading-[0.95]">
            {t("rooms_title")}
          </h1>
          <p className="mt-3 text-[10px] tracking-wider text-white/60">Illustrative photography</p>
        </div>
      </section>

      {/* ── MAIN LAYOUT: filters + grid + sidebar ── */}
      <div className="flex flex-col lg:flex-row min-h-[70vh]">
        {/* Left: rooms list */}
        <div className="flex-1 min-w-0">
          {/* category filter */}
          <div
            className="sticky top-[60px] z-30 px-5 md:px-10 py-4 flex flex-wrap gap-2"
            style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}
          >
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className="text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 transition-all duration-200"
                style={{
                  border: `1px solid ${category === c ? "var(--gold)" : "var(--border-gold)"}`,
                  background: category === c ? "rgba(196,153,90,0.1)" : "transparent",
                  color: category === c ? "var(--gold)" : "var(--muted)",
                }}
              >
                {c === "All" ? t("dest_filter_all") : c}
              </button>
            ))}
            <span className="ml-auto text-[10px] self-center" style={{ color: "var(--muted)" }}>
              {filtered.length} {t("rooms_total_rooms")}
            </span>
            <div className="w-full flex flex-wrap items-center gap-3 pt-3">
              <label className="flex-1 min-w-[180px]">
                <span className="sr-only">{t("rooms_search_placeholder")}</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("rooms_search_placeholder")}
                  className="w-full px-3 py-2 text-[11px] bg-transparent outline-none"
                  style={{ border: "1px solid var(--border-gold)", color: "var(--fg)" }}
                />
              </label>
              <label>
                <span className="sr-only">Minimum guest capacity</span>
                <select
                  value={capacity}
                  onChange={(event) => setCapacity(Number(event.target.value))}
                  className="px-3 py-2 text-[11px] outline-none"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border-gold)", color: "var(--muted)" }}
                >
                  <option value={0}>{t("rooms_capacity_any")}</option>
                  {capacities.map((value) => (
                    <option key={value} value={value}>
                      {t("rooms_at_least")} {value} {t("hero_guests")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: "var(--muted)" }}>
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(event) => setAvailableOnly(event.target.checked)}
                  className="accent-[var(--gold)]"
                />
                {t("rooms_available_only")}
              </label>
            </div>
          </div>

          <div className="px-5 md:px-10 py-10">
            <div className="flex flex-col gap-5">
              {filtered.map((room) => {
                const isSelected = selected.id === room.id;
                const isExpanded = expanded === room.id;
                return (
                  <div
                    key={room.id}
                    className="group transition-all duration-300 cursor-pointer overflow-hidden"
                    style={{
                      border: `1px solid ${isSelected ? "var(--gold)" : "var(--border)"}`,
                      background: isSelected ? "rgba(196,153,90,0.04)" : "var(--bg2)",
                    }}
                    onClick={() => {
                      setSelectedId(room.id);
                      setGuests((value) => Math.min(value, room.guests));
                      setExpanded(isExpanded ? null : room.id);
                    }}
                  >
                    <div className="flex flex-col sm:flex-row gap-0">
                      {/* image */}
                      <div className="sm:w-56 shrink-0 overflow-hidden relative">
                        <div className="aspect-[4/3] sm:aspect-auto sm:h-full">
                          <img
                            src={room.img}
                            alt={`Illustrative photograph for ${room.name}`}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.05]"
                            style={{ minHeight: "160px" }}
                          />
                          <span className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white/80 text-[9px]">
                            Illustrative photo
                          </span>
                        </div>
                      </div>

                      {/* content */}
                      <div className="flex-1 min-w-0 p-5 flex flex-col justify-between">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div
                              className="text-[9px] tracking-[0.2em] uppercase mb-1"
                              style={{ color: isSelected ? "var(--gold)" : "var(--dim)" }}
                            >
                              {room.category} · {room.type}
                            </div>
                            <h3 className="font-display text-xl mb-1" style={{ color: "var(--fg)" }}>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedId(room.id);
                                  setGuests((value) => Math.min(value, room.guests));
                                }}
                                aria-pressed={isSelected}
                                className="text-left"
                              >
                                {room.name}
                              </button>
                            </h3>
                            <div className="flex flex-wrap items-center gap-3 mb-3">
                              {room.rating !== null && (
                                <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--gold)" }}>
                                  <StarIcon />
                                  <span style={{ color: "var(--muted)" }}>{room.rating}</span>
                                </span>
                              )}
                              <span className="text-[9px]" style={{ color: "var(--dim)" }}>
                                {room.sqm !== null && `${room.sqm} m² · `}
                                Up to {room.guests} {t("hero_guests")}
                              </span>
                              <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                                {room.availableNow} {t("rooms_available_now")} · {room.totalRooms} {t("rooms_total_rooms")}
                              </span>
                            </div>
                            <p
                              id={`room-description-${room.id}`}
                              className={`text-[11px] leading-relaxed transition-all duration-300 ${
                                isExpanded ? "max-h-96" : "max-h-0 overflow-hidden"
                              }`}
                              style={{ color: "var(--muted)" }}
                            >
                              {room.description}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-display text-2xl" style={{ color: "var(--gold)" }}>
                              {formatPrice(room.price)}
                            </div>
                            <div className="text-[9px]" style={{ color: "var(--dim)" }}>
                              {t("rooms_base_price")} {t("rooms_per_night")}
                            </div>
                          </div>
                        </div>

                        <div
                          className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4"
                          style={{ borderTop: "1px solid var(--border)" }}
                        >
                          <div className="flex flex-wrap gap-1.5">
                            {room.features.map((f) => (
                              <span
                                key={f}
                                className="flex items-center gap-1 text-[9px] uppercase tracking-wider px-2 py-0.5"
                                style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}
                              >
                                <span style={{ color: "var(--gold)" }}>
                                  <CheckIcon />
                                </span>
                                {f}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 ml-4 shrink-0">
                            <Link
                              href={`/rooms/${room.id}`}
                              className="text-[9px] tracking-[0.14em] uppercase transition-colors"
                              style={{ color: "var(--gold)" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              View →
                            </Link>
                            <button
                              aria-expanded={isExpanded}
                              aria-controls={`room-description-${room.id}`}
                              aria-label={`${isExpanded ? "Hide" : "Show"} information about ${room.name}`}
                              className="text-[9px] tracking-[0.14em] uppercase transition-colors"
                              style={{ color: isSelected ? "var(--gold)" : "var(--muted)" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpanded(isExpanded ? null : room.id);
                              }}
                            >
                              {isExpanded ? "Less ↑" : "Info ↓"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="py-10 text-sm" style={{ color: "var(--muted)" }}>
                  <p>{t("rooms_empty")}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setCategory("All");
                      setSearch("");
                      setCapacity(0);
                      setAvailableOnly(false);
                    }}
                    className="mt-4 text-[10px] uppercase tracking-wider px-4 py-2"
                    style={{ color: "var(--gold)", border: "1px solid var(--border-gold)" }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── STICKY BOOKING SIDEBAR ── */}
        <div
          className="w-full lg:w-[340px] shrink-0"
          style={{ borderLeft: "1px solid var(--border)" }}
        >
          <div
            className="lg:sticky lg:top-[60px] p-6"
            style={{ background: "var(--bg2)" }}
          >
            {/* selected room preview */}
            <div className="mb-6 overflow-hidden" style={{ borderRadius: "4px" }}>
              <div className="aspect-[16/9] overflow-hidden relative">
                <img
                  src={selected.img}
                  alt={`Illustrative photograph for ${selected.name}`}
                  className="w-full h-full object-cover transition-all duration-500"
                />
                <span className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white/80 text-[9px]">
                  Illustrative photo
                </span>
              </div>
              <div className="pt-4">
                <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: "var(--gold)" }}>
                  {selected.category}
                </div>
                <h3 className="font-display text-xl" style={{ color: "var(--fg)" }}>
                  {selected.name}
                </h3>
                <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
                  {selected.type}
                </p>
                {selected.rating !== null && (
                  <div className="flex items-center gap-1 mt-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span
                        key={i}
                        style={{
                          color: i <= Math.floor(selected.rating ?? 0) ? "var(--gold)" : "var(--border-gold)",
                        }}
                      >
                        <StarIcon />
                      </span>
                    ))}
                    <span className="text-[9px] ml-1" style={{ color: "var(--dim)" }}>
                      {selected.rating}
                    </span>
                  </div>
                )}
                <p className="text-[10px] mt-3" style={{ color: "var(--muted)" }}>
                  {selected.availableNow} {t("rooms_available_now")} · {selected.totalRooms} {t("rooms_total_rooms")}
                </p>
              </div>
            </div>

            <div className="h-px mb-6" style={{ background: "var(--border)" }} />

            {/* booking fields */}
            <div className="space-y-4 mb-6">
              <div>
                <label
                  htmlFor="rooms-check-in"
                  className="block text-[9px] tracking-[0.2em] uppercase mb-2"
                  style={{ color: "var(--gold)" }}
                >
                  {t("rooms_checkin_label")}
                </label>
                <input
                  id="rooms-check-in"
                  type="date"
                  min={businessDate}
                  aria-invalid={!validDate}
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="w-full bg-transparent text-sm outline-none pb-2"
                  style={{
                    borderBottom: "1px solid var(--border-gold)",
                    color: "var(--fg)",
                  }}
                />
              </div>
              <div>
                <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                  {t("rooms_duration_label")}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {NIGHTS_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setNights(n)}
                      aria-pressed={nights === n}
                      aria-label={`${n} ${t("rooms_nights")}`}
                      className="text-[10px] px-3 py-1 transition-all duration-200"
                      style={{
                        border: `1px solid ${nights === n ? "var(--gold)" : "var(--border-gold)"}`,
                        background: nights === n ? "rgba(196,153,90,0.12)" : "transparent",
                        color: nights === n ? "var(--gold)" : "var(--muted)",
                      }}
                    >
                      {n} {t("rooms_nights")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                  {t("rooms_guests_label")}
                </label>
                <div className="flex items-center gap-3 pb-2" style={{ borderBottom: "1px solid var(--border-gold)" }}>
                  <button
                    aria-label="Remove one guest"
                    disabled={guestCount <= 1}
                    onClick={() => setGuests((g) => Math.max(1, g - 1))}
                    className="text-lg leading-none w-6 text-center transition-colors"
                    style={{ color: "var(--gold)" }}
                  >
                    −
                  </button>
                  <span className="text-sm w-6 text-center tabular-nums" style={{ color: "var(--fg)" }}>
                    {guestCount}
                  </span>
                  <button
                    aria-label="Add one guest"
                    disabled={guestCount >= selected.guests}
                    onClick={() => setGuests((g) => Math.min(selected.guests, g + 1))}
                    className="text-lg leading-none w-6 text-center transition-colors"
                    style={{ color: "var(--gold)" }}
                  >
                    +
                  </button>
                  <span className="text-[9px] ml-auto" style={{ color: "var(--dim)" }}>
                    max {selected.guests}
                  </span>
                </div>
              </div>
            </div>

            {/* pricing breakdown */}
            <div className="space-y-2.5 mb-5">
              <div className="flex justify-between text-[11px]">
                <span style={{ color: "var(--muted)" }}>
                  {t("rooms_base_price")} {t("rooms_per_night")}
                </span>
                <span style={{ color: "var(--fg)" }}>{formatPrice(selected.price)}</span>
              </div>
              <div className="h-px" style={{ background: "var(--border)" }} />
              <div className="flex justify-between">
                <span className="text-[11px] font-medium" style={{ color: "var(--fg)" }}>
                  {t("rooms_estimate_title")}
                </span>
                <div className="text-right">
                  <div className="font-display text-xl" style={{ color: "var(--gold)" }}>
                    {formatPrice(total)}
                  </div>
                  <div className="text-[9px]" style={{ color: "var(--dim)" }}>
                    for {nights} {t("rooms_nights")}
                  </div>
                </div>
              </div>
            </div>

            <Link
              href={bookingHref}
              aria-disabled={!validDate}
              onClick={(event) => {
                if (!validDate) event.preventDefault();
              }}
              className="w-full block text-center text-[10px] tracking-[0.18em] uppercase py-3.5 transition-all duration-200 font-medium"
              style={{ background: "var(--gold)", color: "var(--bg)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
            >
              {t("rooms_check_final_btn")}
            </Link>
            {!validDate && (
              <p role="alert" className="text-xs mt-3" style={{ color: "var(--gold)" }}>
                Choose a check-in date on or after {businessDate}.
              </p>
            )}
            <p className="text-[9px] text-center mt-3" style={{ color: "var(--dim)" }}>
              Your final price and available rooms depend on your stay dates. This estimate does not reserve a room or guarantee a price.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
