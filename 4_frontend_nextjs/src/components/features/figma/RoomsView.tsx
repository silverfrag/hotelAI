"use client";

import { useState } from "react";
import Link from "next/link";
import type { FigmaRoom } from "@/data/figma-mock";
import { addIsoDays } from "@/utils/businessDate";

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

export default function RoomsView({ rooms, businessDate }: { rooms: FigmaRoom[]; businessDate: string }) {
  const [category, setCategory] = useState("All");
  const [selectedId, setSelectedId] = useState(rooms[0]?.id);
  const selected = rooms.find((room) => room.id === selectedId) ?? rooms[0];
  const [nights, setNights] = useState(3);
  const [checkIn, setCheckIn] = useState(businessDate);
  const [guests, setGuests] = useState(2);
  const [expanded, setExpanded] = useState<number | null>(null);

  const filtered =
    category === "All" ? rooms : rooms.filter((r) => r.category === category);

  const categories = ["All", ...new Set(rooms.map((room) => room.category))];
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && checkIn >= businessDate;

  if (!selected) {
    return <section className="px-5 md:px-10 lg:px-16 pt-32 pb-24"><h1 className="font-display text-4xl mb-4">Refined Spaces</h1><p style={{ color: "var(--muted)" }}>No rooms are available to display. Please try again shortly.</p></section>;
  }

  const guestCount = Math.min(guests, selected.guests);
  const bookingHref = validDate ? `/book?${new URLSearchParams({ room_type_id: String(selected.id), check_in_date: checkIn, check_out_date: addIsoDays(checkIn, nights), guest_count: String(guestCount) })}` : "/book";
  const total = selected.price * nights;
  const tax = Math.round(total * 0.12);
  const serviceFee = 45;

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
              Our Accommodations
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-6xl text-white leading-[0.95]">
            Refined Spaces
          </h1>
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
                {c}
              </button>
            ))}
            <span className="ml-auto text-[10px] self-center" style={{ color: "var(--muted)" }}>
              {filtered.length} rooms
            </span>
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
                      <div className="sm:w-56 shrink-0 overflow-hidden">
                        <div className="aspect-[4/3] sm:aspect-auto sm:h-full">
                          <img
                            src={room.img}
                            alt={room.name}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.05]"
                            style={{ minHeight: "160px" }}
                          />
                        </div>
                      </div>

                      {/* content */}
                      <div className="flex-1 p-5 flex flex-col justify-between">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: isSelected ? "var(--gold)" : "var(--dim)" }}>
                              {room.category} · {room.type}
                            </div>
                            <h3 className="font-display text-xl mb-1" style={{ color: "var(--fg)" }}>
                              <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(room.id); setGuests((value) => Math.min(value, room.guests)); }} aria-pressed={isSelected} className="text-left">{room.name}</button>
                            </h3>
                            <div className="flex items-center gap-3 mb-3">
                              <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--gold)" }}>
                                <StarIcon />
                                <span style={{ color: "var(--muted)" }}>{room.rating}</span>
                              </span>
                              <span className="text-[9px]" style={{ color: "var(--dim)" }}>
                                {room.sqm} m² · Up to {room.guests} guests
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
                              ${room.price}
                            </div>
                            <div className="text-[9px]" style={{ color: "var(--dim)" }}>/night</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                          <div className="flex flex-wrap gap-1.5">
                            {room.features.map((f) => (
                              <span
                                key={f}
                                className="flex items-center gap-1 text-[9px] uppercase tracking-wider px-2 py-0.5"
                                style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}
                              >
                                <span style={{ color: "var(--gold)" }}><CheckIcon /></span>
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
              {filtered.length === 0 && <p className="py-10 text-sm" style={{ color: "var(--muted)" }}>No rooms match this category.</p>}
            </div>
          </div>
        </div>

        {/* ── STICKY BOOKING SIDEBAR ── inspired by image 1 */}
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
              <div className="aspect-[16/9] overflow-hidden">
                <img
                  src={selected.img}
                  alt={selected.name}
                  className="w-full h-full object-cover transition-all duration-500"
                />
              </div>
              <div className="pt-4">
                <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: "var(--gold)" }}>
                  {selected.category}
                </div>
                <h3 className="font-display text-xl" style={{ color: "var(--fg)" }}>{selected.name}</h3>
                <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>{selected.type}</p>
                <div className="flex items-center gap-1 mt-2">
                  {[1,2,3,4,5].map(i => (
                    <span key={i} style={{ color: i <= Math.floor(selected.rating) ? "var(--gold)" : "var(--border-gold)" }}>
                      <StarIcon />
                    </span>
                  ))}
                  <span className="text-[9px] ml-1" style={{ color: "var(--dim)" }}>{selected.rating}</span>
                </div>
              </div>
            </div>

            <div className="h-px mb-6" style={{ background: "var(--border)" }} />

            {/* booking fields */}
            <div className="space-y-4 mb-6">
              <div>
                <label htmlFor="rooms-check-in" className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                  Check-in Date
                </label>
                <input
                  id="rooms-check-in"
                  type="date"
                  min={businessDate}
                  aria-invalid={!validDate}
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="w-full bg-transparent text-sm outline-none pb-2 [color-scheme:dark]"
                  style={{
                    borderBottom: "1px solid var(--border-gold)",
                    color: "var(--fg)",
                  }}
                />
              </div>
              <div>
                <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                  Duration
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {NIGHTS_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setNights(n)}
                      aria-pressed={nights === n}
                      aria-label={`${n} night${n === 1 ? "" : "s"}`}
                      className="text-[10px] px-3 py-1 transition-all duration-200"
                      style={{
                        border: `1px solid ${nights === n ? "var(--gold)" : "var(--border-gold)"}`,
                        background: nights === n ? "rgba(196,153,90,0.12)" : "transparent",
                        color: nights === n ? "var(--gold)" : "var(--muted)",
                      }}
                    >
                      {n}n
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                  Guests
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
                <span style={{ color: "var(--muted)" }}>${selected.price} × {nights} night{nights > 1 ? "s" : ""}</span>
                <span style={{ color: "var(--fg)" }}>${total.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span style={{ color: "var(--muted)" }}>Service fee</span>
                <span style={{ color: "var(--fg)" }}>${serviceFee}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span style={{ color: "var(--muted)" }}>Tax (12%)</span>
                <span style={{ color: "var(--fg)" }}>${tax.toLocaleString()}</span>
              </div>
              <div className="h-px" style={{ background: "var(--border)" }} />
              <div className="flex justify-between">
                <span className="text-[11px] font-medium" style={{ color: "var(--fg)" }}>Total</span>
                <div className="text-right">
                  <div className="font-display text-xl" style={{ color: "var(--gold)" }}>
                    ${(total + tax + serviceFee).toLocaleString()}
                  </div>
                  <div className="text-[9px]" style={{ color: "var(--dim)" }}>for {nights} nights</div>
                </div>
              </div>
            </div>

            <Link
              href={bookingHref}
              aria-disabled={!validDate}
              onClick={(event) => { if (!validDate) event.preventDefault(); }}
              className="w-full block text-center text-[10px] tracking-[0.18em] uppercase py-3.5 transition-all duration-200 font-medium"
              style={{ background: "var(--gold)", color: "var(--bg)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
            >
              Reserve Now
            </Link>
            {!validDate && <p role="alert" className="text-xs mt-3" style={{ color: "var(--gold)" }}>Choose a check-in date on or after {businessDate}.</p>}
            <p className="text-[9px] text-center mt-3" style={{ color: "var(--dim)" }}>
              Free cancellation up to 48h before check-in
            </p>

            {/* payment icons */}
            <div className="flex items-center justify-center gap-2 mt-5">
              {["VISA", "MC", "AMEX", "PayPal"].map((p) => (
                <span
                  key={p}
                  className="text-[8px] tracking-wider px-2 py-1"
                  style={{ border: "1px solid var(--border)", color: "var(--dim)" }}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
