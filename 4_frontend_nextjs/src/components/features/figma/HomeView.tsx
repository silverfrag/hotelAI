"use client";

import { useState } from "react";
import Link from "next/link";
import type { RoomPresentation } from "@/types/room-presentation.type";
import { addIsoDays } from "@/utils/businessDate";
import { useTranslation } from "@/contexts/LanguageContext";
import { CatalogUnavailable } from "./CatalogUnavailable";

const HERO_SLIDES = [
  "/images/whitesand/hero/hotel-exterior.jpg",
  "/images/whitesand/hero/ocean-suite-view.jpg",
  "/images/whitesand/hero/lobby-reception.png",
  "/images/whitesand/hero/restaurant-seaview.png",
];
const CTA_BG = "/images/whitesand/hero/hotel-exterior.jpg";
const GALLERY_LEFT = "/images/whitesand/hero/ocean-suite-view.jpg";
const GALLERY_RIGHT = "/images/whitesand/facilities/restaurant-14f.jpg";

interface FacilityHighlight {
  id: string;
  floorKey: string;
  floorCode: string;
  tag: string;
  name: string;
  tagline: string;
  img: string;
  href: string;
}

const HOTEL_FACILITIES: readonly FacilityHighlight[] = [
  {
    id: "Lobby 1F",
    floorKey: "dest_filter_beach",
    floorCode: "1F",
    tag: "24/7 Service",
    name: "Sảnh Lễ Tân & Concierge",
    tagline: "89-91 Võ Văn Kiệt · Đón tiếp 24/7",
    img: "/images/whitesand/facilities/concierge-reception.jpg",
    href: "/about",
  },
  {
    id: "Pool & Gym 2F",
    floorKey: "dest_filter_mountain",
    floorCode: "2F",
    tag: "Wellness",
    name: "Hồ Bơi & Phòng Gym",
    tagline: "Tầng 2 · Thư giãn & rèn luyện",
    img: "/images/whitesand/facilities/pool-gym-2f.jpg",
    href: "/about",
  },
  {
    id: "Dining 14F",
    floorKey: "dest_filter_city",
    floorCode: "14F",
    tag: "Seaview",
    name: "Nhà Hàng Sky View 14F",
    tagline: "Tầng 14 · Buffet & ẩm thực biển Mỹ Khê",
    img: "/images/whitesand/facilities/restaurant-14f.jpg",
    href: "/about",
  },
  {
    id: "Spa 15F",
    floorKey: "dest_filter_island",
    floorCode: "15F",
    tag: "Rooftop Spa",
    name: "White Sand Spa 15F",
    tagline: "Tầng 15 · Trị liệu thảo mộc & đá nóng",
    img: "/images/whitesand/facilities/spa-15f.jpg",
    href: "/rooms",
  },
];

const FACILITY_FILTERS = [
  { id: "All", labelKey: "dest_filter_all" },
  { id: "Lobby 1F", labelKey: "dest_filter_beach" },
  { id: "Pool & Gym 2F", labelKey: "dest_filter_mountain" },
  { id: "Dining 14F", labelKey: "dest_filter_city" },
  { id: "Spa 15F", labelKey: "dest_filter_island" },
] as const;

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

export default function HomeView({ rooms, businessDate, catalogError = false }: { rooms: RoomPresentation[]; businessDate: string; catalogError?: boolean }) {
  const { t, formatPrice } = useTranslation();
  const [activeFilter, setActiveFilter] = useState("All");
  const [checkIn, setCheckIn] = useState(businessDate);
  const [checkOut, setCheckOut] = useState(addIsoDays(businessDate, 2));
  const [guests, setGuests] = useState(2);
  const [activeDot, setActiveDot] = useState(0);

  const filteredFacilities =
    activeFilter === "All"
      ? HOTEL_FACILITIES
      : HOTEL_FACILITIES.filter((item) => item.id === activeFilter);

  const featuredRooms = rooms.slice(0, 6);

  return (
    <>
      {/* ── HERO ── */}
      <section className="relative min-h-[900px] sm:min-h-[680px] sm:h-screen flex flex-col justify-end overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${HERO_SLIDES[activeDot] ?? HERO_SLIDES[0]})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.92)] via-[rgba(0,0,0,0.38)] to-[rgba(0,0,0,0.18)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(0,0,0,0.65)] via-transparent to-transparent" />

        {/* side dots */}
        <div className="absolute right-6 md:right-10 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-10">
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              onClick={() => setActiveDot(i)}
              aria-label={`Xem hình ảnh White Sand ${i + 1}`}
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

        {/* hotel scale highlights */}
        <div className="absolute top-32 right-16 lg:right-28 hidden lg:flex flex-col gap-3">
          {[
            { label: t("hero_stat_collection"), value: t("hero_collection_value") },
            { label: t("hero_stat_stay"), value: t("hero_stay_value") },
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
                {t("hero_eyebrow")}
              </span>
            </div>
            <h1 className="font-display leading-[0.93] text-white mb-6 text-5xl md:text-7xl lg:text-[5.5rem]">
              {t("hero_title_1")}
              <br />
              <em className="not-italic" style={{ color: "var(--gold)" }}>
                {t("hero_title_2")}
              </em>{" "}
              {t("hero_title_3")}
            </h1>
            <p className="text-sm text-[rgba(255,255,255,0.68)] max-w-md leading-relaxed mb-10">
              {t("hero_desc")}
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
                  <div className="block text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    {t("hero_dest")}
                  </div>
                  <p
                    className="w-full text-sm text-white/90 pb-3 truncate"
                    style={{ borderBottom: "1px solid rgba(196,153,90,0.18)" }}
                    title={t("hero_where_to")}
                  >
                    {t("hero_where_to")}
                  </p>
                </div>
                <div className="lg:px-7">
                  <label htmlFor="home-check-in" className="block text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    {t("hero_check_in")}
                  </label>
                  <input
                    id="home-check-in"
                    type="date"
                    value={checkIn}
                    aria-label="Check in"
                    required
                    min={businessDate}
                    onChange={(e) => {
                      const next = e.target.value;
                      setCheckIn(next);
                      if (next >= checkOut) setCheckOut(addIsoDays(next, 1));
                    }}
                    className="w-full bg-transparent text-sm text-white outline-none pb-3 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid rgba(196,153,90,0.18)" }}
                  />
                </div>
                <div className="lg:px-7">
                  <label htmlFor="home-check-out" className="block text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    {t("hero_check_out")}
                  </label>
                  <input
                    id="home-check-out"
                    type="date"
                    value={checkOut}
                    aria-label="Check out"
                    required
                    min={addIsoDays(checkIn || businessDate, 1)}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full bg-transparent text-sm text-white outline-none pb-3 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid rgba(196,153,90,0.18)" }}
                  />
                </div>
                <div className="lg:pl-7 flex items-end gap-4">
                  <div className="flex-1">
                    <div className="block text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                      {t("hero_guests")}
                    </div>
                    <div className="flex items-center gap-3 pb-3" style={{ borderBottom: "1px solid rgba(196,153,90,0.18)" }}>
                      <button type="button" aria-label="Fewer guests" onClick={() => setGuests((g) => Math.max(1, g - 1))} className="text-lg leading-none w-5 text-center" style={{ color: "var(--gold)" }}>−</button>
                      <span className="text-sm text-white w-5 text-center tabular-nums">{guests}</span>
                      <button type="button" aria-label="More guests" onClick={() => setGuests((g) => Math.min(4, g + 1))} className="text-lg leading-none w-5 text-center" style={{ color: "var(--gold)" }}>+</button>
                    </div>
                  </div>
                  <Link
                    href={`/book?${new URLSearchParams({ check_in_date: checkIn, check_out_date: checkOut, guest_count: String(guests) })}`}
                    aria-disabled={!checkIn || !checkOut || checkIn < businessDate || checkOut <= checkIn}
                    onClick={(event) => {
                      if (!checkIn || !checkOut || checkIn < businessDate || checkOut <= checkIn) {
                        event.preventDefault();
                        event.currentTarget.closest("section")?.querySelector("input:invalid")?.scrollIntoView();
                      }
                    }}
                    className="text-[10px] tracking-[0.16em] uppercase px-6 py-3 font-medium mb-[1px] flex items-center gap-2 shrink-0 transition-colors duration-200"
                    style={{ background: "var(--gold)", color: "var(--bg)" }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "var(--gold)")
                    }
                  >
                    {t("hero_search")} <ArrowRight />
                  </Link>
                </div>
              </div>
              <div className="mt-5 h-px" style={{ background: "linear-gradient(to right, var(--gold), rgba(196,153,90,0.2), transparent)" }} />
            </div>
          </div>
        </div>
      </section>

      {/* ── HOTEL FACILITIES (1F – 15F) ── */}
      <section
        className="px-5 md:px-10 lg:px-16 py-24"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-8" style={{ background: "var(--gold)" }} />
              <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
                {t("dest_eyebrow")}
              </span>
            </div>
            <h2 className="font-display text-4xl md:text-5xl leading-[1.0]" style={{ color: "var(--fg)" }}>
              {t("dest_title")}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {FACILITY_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFilter(f.id)}
                className="text-[10px] tracking-[0.14em] uppercase px-4 py-1.5 transition-all duration-200"
                style={{
                  border: `1px solid ${activeFilter === f.id ? "var(--gold)" : "var(--border-gold)"}`,
                  background: activeFilter === f.id ? "rgba(196,153,90,0.1)" : "transparent",
                  color: activeFilter === f.id ? "var(--gold)" : "var(--muted)",
                }}
              >
                {t(f.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filteredFacilities.map((facility) => (
            <Link
              key={facility.id}
              href={facility.href}
              className="group cursor-pointer block"
            >
              <div
                className="relative overflow-hidden"
                style={{ borderRadius: "9999px 9999px 6px 6px" }}
              >
                <div className="aspect-[3/4.2]">
                  <img
                    src={facility.img}
                    alt={facility.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.88)] via-[rgba(0,0,0,0.08)] to-transparent" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] tracking-[0.22em] uppercase" style={{ color: "var(--gold)" }}>
                      {facility.tagline}
                    </span>
                    <span className="text-[10px] text-white/70 flex items-center gap-1">
                      <StarIcon /> {facility.floorCode}
                    </span>
                  </div>
                  <h3 className="font-display text-xl text-white">{facility.name}</h3>
                  <div
                    className="flex items-center justify-between mt-3 pt-3"
                    style={{ borderTop: "1px solid rgba(196,153,90,0.2)" }}
                  >
                    <span className="text-[11px] text-white/60">
                      <span className="text-white/90 font-medium">{t("dest_card_sub")}</span>
                    </span>
                    <span className="text-[9px] text-white/40 uppercase tracking-wider">
                      {facility.tag}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <span
                  className="text-[10px] tracking-[0.16em] uppercase flex items-center gap-1.5 transition-all duration-200"
                  style={{ color: "var(--gold)" }}
                >
                  {t("dest_explore")} <ArrowRight />
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="flex justify-center mt-14">
          <Link
            href="/about"
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
            {t("dest_view_all")}
          </Link>
        </div>
      </section>

      {/* ── ROOMS (ALL 6 WHITE SAND CATEGORIES) ── */}
      <section
        className="py-24"
        style={{ background: "var(--bg2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="px-5 md:px-10 lg:px-16 mb-14">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              {t("rooms_eyebrow")}
            </span>
          </div>
          <div className="flex items-end justify-between">
            <h2 className="font-display text-4xl md:text-5xl leading-[1.0]" style={{ color: "var(--fg)" }}>
              {t("rooms_title")}
            </h2>
            <Link
              href="/rooms"
              className="hidden md:block text-[10px] tracking-[0.14em] uppercase transition-colors underline underline-offset-4"
              style={{ color: "var(--muted)" }}
            >
              {t("rooms_view_all")}
            </Link>
          </div>
        </div>

        {catalogError ? (
          <div className="mx-5 md:mx-10 lg:mx-16">
            <CatalogUnavailable />
          </div>
        ) : (
          <div
            className="mx-5 md:mx-10 lg:mx-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px"
            style={{ background: "var(--border)" }}
          >
            {!featuredRooms.length && (
              <p className="p-8 text-sm sm:col-span-2 lg:col-span-3" style={{ color: "var(--muted)", background: "var(--bg2)" }}>
                {t("rooms_empty")}
              </p>
            )}
            {featuredRooms.map((room) => (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
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
                    {room.floor ? `${room.type} · ${room.floor}` : room.type}
                  </div>
                  <h3 className="font-display text-lg mb-3" style={{ color: "var(--fg)" }}>
                    {room.name}
                  </h3>
                  <div className="text-[10px] mb-3" style={{ color: "var(--dim)" }}>
                    {room.guests} {t("rooms_max_guests")} · {room.availableNow}/{room.totalRooms} {t("rooms_available_now")}
                  </div>
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
                      <span className="font-display text-lg" style={{ color: "var(--gold)" }}>
                        {formatPrice(room.price)}
                      </span>
                      <span className="text-[10px] ml-1" style={{ color: "var(--dim)" }}>{t("rooms_per_night")}</span>
                    </div>
                    <span className="text-[9px] tracking-[0.18em] uppercase flex items-center gap-1" style={{ color: "var(--gold)" }}>
                      {t("rooms_book")} <ArrowRight />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── PLANNING STEPS ── */}
      <section className="px-5 md:px-10 lg:px-16 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-8" style={{ background: "var(--gold)" }} />
              <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
                {t("why_eyebrow")}
              </span>
            </div>
            <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-8" style={{ color: "var(--fg)" }}>
              {t("why_title")}
            </h2>
            <p className="leading-relaxed text-sm mb-10 max-w-md" style={{ color: "var(--muted)" }}>
              {t("why_desc")}
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
              {t("why_story_btn")} <ArrowRight />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: t("why_stat_1_val"), label: t("why_stat_1_label"), sub: t("why_stat_1_sub") },
              { value: t("why_stat_2_val"), label: t("why_stat_2_label"), sub: t("why_stat_2_sub") },
              { value: t("why_stat_3_val"), label: t("why_stat_3_label"), sub: t("why_stat_3_sub") },
              { value: t("why_stat_4_val"), label: t("why_stat_4_label"), sub: t("why_stat_4_sub") },
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
        <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[rgba(0,0,0,0.55)] to-transparent" />
        <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-[rgba(0,0,0,0.55)] to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <div className="text-[9px] tracking-[0.3em] uppercase mb-5" style={{ color: "var(--gold)" }}>
            {t("gallery_eyebrow")}
          </div>
          <h2 className="font-display text-4xl md:text-6xl lg:text-7xl text-white leading-[0.95]">
            {t("gallery_title_1")}<br />
            <em className="not-italic" style={{ color: "var(--gold)" }}>{t("gallery_title_2")}</em>
          </h2>
          <Link
            href="/rooms"
            className="mt-8 text-[10px] tracking-[0.18em] uppercase px-8 py-3 transition-all duration-300"
            style={{ border: "1px solid rgba(196,153,90,0.5)", color: "var(--gold)" }}
          >
            {t("gallery_btn")}
          </Link>
        </div>
      </section>

      {/* ── SERVICE PHILOSOPHY ── */}
      <section
        className="px-5 md:px-10 lg:px-16 py-24"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="max-w-3xl mx-auto text-center">
          <div
            className="font-display text-8xl leading-none mb-2 select-none"
            style={{ color: "rgba(196,153,90,0.1)" }}
          >
            &ldquo;
          </div>
          <blockquote
            className="font-display text-2xl md:text-3xl leading-snug mb-10 italic -mt-6"
            style={{ color: "var(--fg)" }}
          >
            {t("philosophy_quote")}
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--fg2)" }}>White Sand Boutique Hotel</div>
              <div className="text-[9px] tracking-[0.2em] uppercase mt-0.5" style={{ color: "var(--dim)" }}>
                {t("philosophy_sub")}
              </div>
            </div>
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
                {t("cta_eyebrow")}
              </span>
            </div>
            <h3 className="font-display text-3xl md:text-4xl text-white mb-2 leading-tight">
              {t("cta_title")}
            </h3>
            <p className="text-sm text-white/60">
              {t("cta_desc")}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Link
              href="/rooms"
              className="text-[10px] tracking-[0.16em] uppercase px-8 py-3 font-medium whitespace-nowrap transition-colors duration-200"
              style={{ background: "var(--gold)", color: "var(--bg)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
            >
              {t("cta_explore_btn")}
            </Link>
            <Link
              href="/book"
              className="text-[10px] tracking-[0.16em] uppercase px-8 py-3 whitespace-nowrap transition-all duration-300"
              style={{ border: "1px solid rgba(196,153,90,0.4)", color: "var(--gold)" }}
            >
              {t("cta_plan_btn")}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
