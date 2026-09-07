"use client";

import { useState } from "react";
import Link from "next/link";
import { destinations, type FigmaRoom } from "@/data/figma-mock";
import { addIsoDays } from "@/utils/businessDate";

const HERO_BG =
  "https://images.unsplash.com/photo-1590523277543-a94d2e4eb00b?w=1920&h=1080&fit=crop&auto=format";
const CTA_BG =
  "https://images.unsplash.com/photo-1755305931952-771879c20030?w=1400&h=500&fit=crop&auto=format";
const GALLERY_LEFT =
  "https://images.unsplash.com/photo-1609601546193-f558f1ebb385?w=900&h=600&fit=crop&auto=format";
const GALLERY_RIGHT =
  "https://images.unsplash.com/photo-1725140310293-21e9d923f2f3?w=900&h=600&fit=crop&auto=format";

const FILTERS = ["All", "Beach", "Mountain", "City", "Island"];

function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6.5h9M8 3l3.5 3.5L8 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
      <path d="M5 0.5L6.18 3.68L9.51 3.9L6.89 6.12L7.74 9.37L5 7.6L2.26 9.37L3.11 6.12L0.49 3.9L3.82 3.68L5 0.5Z" />
    </svg>
  );
}

export default function HomeView({ rooms, businessDate }: { rooms: FigmaRoom[]; businessDate: string }) {
  const [activeFilter, setActiveFilter] = useState("All");
  const [destination, setDestination] = useState("");
  const [checkIn, setCheckIn] = useState(businessDate);
  const [checkOut, setCheckOut] = useState(addIsoDays(businessDate, 5));
  const [guests, setGuests] = useState(2);
  const [activeDot, setActiveDot] = useState(0);

  const featured = destinations.slice(0, 4);
  const filtered =
    activeFilter === "All"
      ? featured
      : destinations.filter((d) => d.tag === activeFilter).slice(0, 4);

  const featuredRooms = rooms.slice(0, 4);

  return (
    <>
      {/* ── HERO ── */}
      <section className="relative h-screen min-h-[680px] flex flex-col justify-end overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${[HERO_BG, ...destinations.slice(1, 4).map((d) => d.imgWide)][activeDot]})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.92)] via-[rgba(0,0,0,0.38)] to-[rgba(0,0,0,0.18)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(0,0,0,0.65)] via-transparent to-transparent" />

        {/* side dots */}
        <div className="absolute right-6 md:right-10 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-10">
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              onClick={() => setActiveDot(i)}
              aria-label={`View retreat image ${i + 1}`}
              aria-pressed={activeDot === i}
              className="rounded-full transition-all duration-400"
              style={{
                width: "6px",
                height: activeDot === i ? "32px" : "8px",
                background:
                  activeDot === i
                    ? "var(--gold)"
                    : "rgba(196,153,90,0.3)",
              }}
            />
          ))}
        </div>

        {/* floating stats */}
        <div className="absolute top-32 right-16 lg:right-28 hidden lg:flex flex-col gap-3">
          {[
            { label: "Guests Served", value: "48,000+" },
            { label: "Satisfaction", value: "98.6%" },
          ].map((s) => (
            <div
              key={s.label}
              className="backdrop-blur-xl px-5 py-4"
              style={{
                background: "rgba(12,9,5,0.72)",
                border: "1px solid var(--border-gold)",
              }}
            >
              <div
                className="text-[9px] tracking-[0.22em] uppercase mb-1.5"
                style={{ color: "var(--gold)" }}
              >
                {s.label}
              </div>
              <div className="font-display text-2xl text-white">{s.value}</div>
            </div>
          ))}
        </div>

        {/* headline */}
        <div className="relative z-10 px-5 md:px-10 lg:px-16 pb-0">
          <div className="max-w-5xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-px w-10" style={{ background: "var(--gold)" }} />
              <span
                className="text-[10px] tracking-[0.28em] uppercase"
                style={{ color: "var(--gold)" }}
              >
                World's Finest Retreats
              </span>
            </div>
            <h1 className="font-display leading-[0.93] text-white mb-6 text-5xl md:text-7xl lg:text-[5.5rem]">
              Where Luxury
              <br />
              <em className="not-italic" style={{ color: "var(--gold)" }}>
                Meets
              </em>{" "}
              Horizon
            </h1>
            <p className="text-sm text-[rgba(255,255,255,0.6)] max-w-sm leading-relaxed mb-10">
              Curated sanctuaries at the world's most breathtaking destinations.
              Every detail designed for the extraordinary.
            </p>
          </div>
        </div>

        {/* booking widget */}
        <div className="relative z-10 mx-4 md:mx-10 lg:mx-16 mb-[-1px]">
          <div
            className="backdrop-blur-2xl"
            style={{
              background: "rgba(10,7,4,0.88)",
              border: "1px solid var(--border-gold)",
              borderBottom: "none",
            }}
          >
            <div className="px-6 md:px-8 pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-0 lg:divide-x divide-[rgba(196,153,90,0.12)]">
                <div className="lg:pr-7">
                  <label className="block text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Destination
                  </label>
                  <input
                    type="text"
                    placeholder="Where to?"
                    aria-label="Destination inspiration"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className="w-full bg-transparent text-sm text-white placeholder:text-[rgba(255,255,255,0.2)] outline-none pb-3 focus:border-b-[var(--gold)]"
                    style={{ borderBottom: "1px solid rgba(196,153,90,0.18)" }}
                  />
                </div>
                <div className="lg:px-7">
                  <label className="block text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Check In
                  </label>
                  <input
                    type="date"
                    value={checkIn}
                    aria-label="Check in"
                    required min={businessDate}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="w-full bg-transparent text-sm text-white outline-none pb-3 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid rgba(196,153,90,0.18)" }}
                  />
                </div>
                <div className="lg:px-7">
                  <label className="block text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Check Out
                  </label>
                  <input
                    type="date"
                    value={checkOut}
                    aria-label="Check out"
                    required min={addIsoDays(checkIn || businessDate, 1)}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full bg-transparent text-sm text-white outline-none pb-3 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid rgba(196,153,90,0.18)" }}
                  />
                </div>
                <div className="lg:pl-7 flex items-end gap-4">
                  <div className="flex-1">
                    <label className="block text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                      Guests
                    </label>
                    <div className="flex items-center gap-3 pb-3" style={{ borderBottom: "1px solid rgba(196,153,90,0.18)" }}>
                      <button aria-label="Fewer guests" onClick={() => setGuests((g) => Math.max(1, g - 1))} className="text-lg leading-none w-5 text-center" style={{ color: "var(--gold)" }}>−</button>
                      <span className="text-sm text-white w-5 text-center tabular-nums">{guests}</span>
                      <button aria-label="More guests" onClick={() => setGuests((g) => Math.min(20, g + 1))} className="text-lg leading-none w-5 text-center" style={{ color: "var(--gold)" }}>+</button>
                    </div>
                  </div>
                  <Link
                    href={`/book?${new URLSearchParams({ destination, check_in_date: checkIn, check_out_date: checkOut, guest_count: String(guests) })}`}
                    aria-disabled={!checkIn || !checkOut || checkIn < businessDate || checkOut <= checkIn}
                    onClick={(event) => { if (!checkIn || !checkOut || checkIn < businessDate || checkOut <= checkIn) { event.preventDefault(); event.currentTarget.closest("section")?.querySelector("input:invalid")?.scrollIntoView(); } }}
                    className="text-[10px] tracking-[0.16em] uppercase px-6 py-3 font-medium mb-[1px] flex items-center gap-2 shrink-0 transition-colors duration-200"
                    style={{ background: "var(--gold)", color: "var(--bg)" }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "var(--gold)")
                    }
                  >
                    Search <ArrowRight />
                  </Link>
                </div>
              </div>
              <div className="mt-5 h-px" style={{ background: "linear-gradient(to right, var(--gold), rgba(196,153,90,0.2), transparent)" }} />
            </div>
          </div>
        </div>
      </section>

      {/* ── DESTINATIONS ── */}
      <section
        className="px-5 md:px-10 lg:px-16 py-24"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-8" style={{ background: "var(--gold)" }} />
              <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
                Handpicked Escapes
              </span>
            </div>
            <h2 className="font-display text-4xl md:text-5xl leading-[1.0]" style={{ color: "var(--fg)" }}>
              Your dream<br />destination awaits
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className="text-[10px] tracking-[0.14em] uppercase px-4 py-1.5 transition-all duration-200"
                style={{
                  border: `1px solid ${activeFilter === f ? "var(--gold)" : "var(--border-gold)"}`,
                  background: activeFilter === f ? "rgba(196,153,90,0.1)" : "transparent",
                  color: activeFilter === f ? "var(--gold)" : "var(--muted)",
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filtered.map((dest) => (
            <Link
              key={dest.id}
              href={`/destinations`}
              className="group cursor-pointer block"
            >
              <div
                className="relative overflow-hidden"
                style={{ borderRadius: "9999px 9999px 6px 6px" }}
              >
                <div className="aspect-[3/4.2]">
                  <img
                    src={dest.img}
                    alt={dest.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.88)] via-[rgba(0,0,0,0.08)] to-transparent" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] tracking-[0.22em] uppercase" style={{ color: "var(--gold)" }}>
                      {dest.tagline}
                    </span>
                    <span className="text-[10px] text-white/60 flex items-center gap-1">
                      <StarIcon /> {dest.rating}
                    </span>
                  </div>
                  <h3 className="font-display text-xl text-white">{dest.name}</h3>
                  <div
                    className="flex items-center justify-between mt-3 pt-3"
                    style={{ borderTop: "1px solid rgba(196,153,90,0.2)" }}
                  >
                    <span className="text-[11px] text-white/50">
                      from <span className="text-white/90 font-medium">{dest.price}</span>/night
                    </span>
                    <span className="text-[9px] text-white/30 uppercase tracking-wider">
                      {dest.nights} nights
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <span
                  className="text-[10px] tracking-[0.16em] uppercase flex items-center gap-1.5 transition-all duration-200"
                  style={{ color: "var(--gold)" }}
                >
                  Explore <ArrowRight />
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="flex justify-center mt-14">
          <Link
            href="/destinations"
            className="text-[10px] tracking-[0.18em] uppercase px-10 py-3 transition-all duration-300"
            style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)";
              (e.currentTarget as HTMLElement).style.color = "var(--gold)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border-gold)";
              (e.currentTarget as HTMLElement).style.color = "var(--muted)";
            }}
          >
            View All Destinations
          </Link>
        </div>
      </section>

      {/* ── ROOMS ── */}
      <section
        className="py-24"
        style={{ background: "var(--bg2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="px-5 md:px-10 lg:px-16 mb-14">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              Our Accommodations
            </span>
          </div>
          <div className="flex items-end justify-between">
            <h2 className="font-display text-4xl md:text-5xl leading-[1.0]" style={{ color: "var(--fg)" }}>
              Refined spaces,<br />boundless comfort
            </h2>
            <Link
              href="/rooms"
              className="hidden md:block text-[10px] tracking-[0.14em] uppercase transition-colors underline underline-offset-4"
              style={{ color: "var(--muted)" }}
            >
              View all rooms
            </Link>
          </div>
        </div>

        <div
          className="mx-5 md:mx-10 lg:mx-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px"
          style={{ background: "var(--border)" }}
        >
          {featuredRooms.map((room) => (
            <Link
              key={room.id}
              href="/rooms"
              className="group block overflow-hidden"
              style={{ background: "var(--bg2)" }}
            >
              <div className="overflow-hidden aspect-[4/3]">
                <img
                  src={room.img}
                  alt={room.name}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
                />
              </div>
              <div className="p-5">
                <div className="text-[9px] tracking-[0.2em] uppercase mb-1.5" style={{ color: "var(--dim)" }}>
                  {room.type}
                </div>
                <h3 className="font-display text-lg mb-3" style={{ color: "var(--fg)" }}>
                  {room.name}
                </h3>
                <div className="text-[10px] mb-3" style={{ color: "var(--dim)" }}>{room.sqm} m²</div>
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {room.features.slice(0, 3).map((f) => (
                    <span
                      key={f}
                      className="text-[9px] tracking-wider uppercase px-2 py-0.5"
                      style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}
                    >
                      {f}
                    </span>
                  ))}
                </div>
                <div
                  className="flex items-center justify-between pt-4"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <div>
                    <span className="font-display text-xl" style={{ color: "var(--gold)" }}>
                      ${room.price}
                    </span>
                    <span className="text-[10px] ml-1" style={{ color: "var(--dim)" }}>/night</span>
                  </div>
                  <span className="text-[9px] tracking-[0.18em] uppercase flex items-center gap-1" style={{ color: "var(--gold)" }}>
                    Book <ArrowRight />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="px-5 md:px-10 lg:px-16 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-8" style={{ background: "var(--gold)" }} />
              <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
                Why Aurum
              </span>
            </div>
            <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-8" style={{ color: "var(--fg)" }}>
              Every journey,<br />a masterpiece
            </h2>
            <p className="leading-relaxed text-sm mb-10 max-w-md" style={{ color: "var(--muted)" }}>
              We believe travel is an art form. From the first search to the final farewell, Aurum orchestrates experiences that transcend the ordinary — where precision meets passion.
            </p>
            <Link
              href="/about"
              className="text-[10px] tracking-[0.18em] uppercase px-8 py-3 flex items-center gap-2 w-fit transition-all duration-300"
              style={{ border: "1px solid var(--gold)", color: "var(--gold)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--gold)";
                (e.currentTarget as HTMLElement).style.color = "var(--bg)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--gold)";
              }}
            >
              Our Story <ArrowRight />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: "200+", label: "Luxury Properties", sub: "Across 42 countries" },
              { value: "48K", label: "Happy Guests", sub: "And counting" },
              { value: "98%", label: "Satisfaction Rate", sub: "Verified reviews" },
              { value: "15yr", label: "Of Excellence", sub: "In luxury travel" },
            ].map((stat, i) => (
              <div
                key={i}
                className="p-6 transition-all duration-300"
                style={{
                  border: "1px solid var(--border-gold)",
                  background: i === 1 ? "rgba(196,153,90,0.05)" : "transparent",
                }}
              >
                <div className="font-display text-3xl mb-2" style={{ color: "var(--gold)" }}>
                  {stat.value}
                </div>
                <div className="text-[11px] font-medium mb-1" style={{ color: "var(--fg)" }}>
                  {stat.label}
                </div>
                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--dim)" }}>
                  {stat.sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── GALLERY SPLIT ── */}
      <section className="relative overflow-hidden h-[380px] md:h-[500px]">
        <div className="absolute inset-0 flex">
          <div className="w-1/2 bg-cover bg-center" style={{ backgroundImage: `url(${GALLERY_LEFT})` }} />
          <div className="w-1/2 bg-cover bg-center" style={{ backgroundImage: `url(${GALLERY_RIGHT})` }} />
        </div>
        <div className="absolute inset-0 bg-[rgba(0,0,0,0.5)]" />
        <div
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-28 bg-[rgba(0,0,0,0.0)]"
          style={{ clipPath: "polygon(35% 0, 65% 0, 65% 100%, 35% 100%)", background: "transparent" }}
        />
        <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[rgba(0,0,0,0.55)] to-transparent" />
        <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-[rgba(0,0,0,0.55)] to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <div className="text-[9px] tracking-[0.3em] uppercase mb-5" style={{ color: "var(--gold)" }}>
            140+ Destinations · 200+ Properties
          </div>
          <h2 className="font-display text-4xl md:text-6xl lg:text-7xl text-white leading-[0.95]">
            The World<br />
            <em className="not-italic" style={{ color: "var(--gold)" }}>Is Yours</em>
          </h2>
          <Link
            href="/destinations"
            className="mt-8 text-[10px] tracking-[0.18em] uppercase px-8 py-3 transition-all duration-300"
            style={{ border: "1px solid rgba(196,153,90,0.5)", color: "var(--gold)" }}
          >
            Explore All Destinations
          </Link>
        </div>
      </section>

      {/* ── TESTIMONIAL ── */}
      <section
        className="px-5 md:px-10 lg:px-16 py-24"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="max-w-3xl mx-auto text-center">
          <div
            className="font-display text-8xl leading-none mb-2 select-none"
            style={{ color: "rgba(196,153,90,0.1)" }}
          >
            "
          </div>
          <blockquote
            className="font-display text-2xl md:text-3xl leading-snug mb-10 italic -mt-6"
            style={{ color: "var(--fg)" }}
          >
            Aurum didn't just book us a hotel. They composed an entire chapter of our lives we'll never forget.
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <img
              src="https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=80&h=80&fit=crop&auto=format"
              alt="Sofia Laurent"
              className="w-12 h-12 rounded-full object-cover"
              style={{ border: "1px solid var(--border-gold)" }}
            />
            <div className="text-left">
              <div className="text-sm font-medium" style={{ color: "var(--fg2)" }}>Sofia Laurent</div>
              <div className="text-[9px] tracking-[0.2em] uppercase mt-0.5" style={{ color: "var(--dim)" }}>
                Maldives Retreat, 2026
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} style={{ color: "var(--gold)" }}><StarIcon /></span>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="relative overflow-hidden mx-5 md:mx-10 lg:mx-16 mb-24">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${CTA_BG})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(0,0,0,0.85)] to-[rgba(0,0,0,0.5)]" />
        <div className="relative z-10 py-16 px-8 md:px-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-6" style={{ background: "var(--gold)" }} />
              <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
                Begin Your Journey
              </span>
            </div>
            <h3 className="font-display text-3xl md:text-4xl text-white mb-2 leading-tight">
              Ready to begin?
            </h3>
            <p className="text-sm text-white/50">
              Your curated escape is one conversation away.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Link
              href="/destinations"
              className="text-[10px] tracking-[0.16em] uppercase px-8 py-3 font-medium whitespace-nowrap transition-colors duration-200"
              style={{ background: "var(--gold)", color: "var(--bg)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
            >
              Explore All Retreats
            </Link>
            <Link
              href="/book"
              className="text-[10px] tracking-[0.16em] uppercase px-8 py-3 whitespace-nowrap transition-all duration-300"
              style={{ border: "1px solid rgba(196,153,90,0.4)", color: "var(--gold)" }}
            >
              Talk to an Expert
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
