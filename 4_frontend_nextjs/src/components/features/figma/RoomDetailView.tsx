"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { RoomPresentation } from "@/types/room-presentation.type";
import { addIsoDays } from "@/utils/businessDate";
import { formatCurrency } from "@/utils/formatCurrency";

type TabKey = "description" | "features" | "virtual" | "reviews";

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/* ── tiny icon set ── */
function FeatureIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    wifi: "⌘",
    bed: "⬜",
    bath: "◉",
    shower: "◎",
    coffee: "◆",
    chef: "✦",
    pool: "≈",
    ocean: "〜",
    size: "⊡",
  };
  return (
    <span className="text-[11px]" style={{ color: "var(--gold)" }}>
      {icons[type] ?? "·"}
    </span>
  );
}

function StarFilled({ filled }: { filled: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 10 10"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="0.8"
    >
      <path d="M5 0.5L6.18 3.68L9.51 3.9L6.89 6.12L7.74 9.37L5 7.6L2.26 9.37L3.11 6.12L0.49 3.9L3.82 3.68L5 0.5Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 6l3 3L10 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RoomDetailView({ room, businessDate }: { room: RoomPresentation; businessDate: string }) {
  const galleryDialog = useRef<HTMLDialogElement>(null);
  const gallery = room.gallery.length > 0 ? room.gallery : [room.img];
  const [activeTab, setActiveTab] = useState<TabKey>("description");
  const [activeGalleryImg, setActiveGalleryImg] = useState(0);
  const [checkIn, setCheckIn] = useState(businessDate);
  const [checkOut, setCheckOut] = useState(addIsoDays(businessDate, 3));
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const validDates = isCalendarDate(checkIn) && isCalendarDate(checkOut) && checkIn >= businessDate && checkOut > checkIn;
  const nights = validDates ? Math.round((new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86400000) : 0;
  const bookingHref = `/book?${new URLSearchParams({ room_type_id: String(room.id), check_in_date: checkIn, check_out_date: checkOut, guest_count: String(adults + children) })}`;

  const roomTotal = room.price * nights;

  const TABS: { key: TabKey; label: string }[] = [
    { key: "description", label: "Description" },
    { key: "features", label: "Features" },
    { key: "virtual", label: "Virtual" },
    { key: "reviews", label: "Reviews" },
  ];

  return (
    <div className="pt-20" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      <dialog ref={galleryDialog} aria-label={`${room.name} photo gallery`} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-5xl max-h-[90vh] p-4 backdrop:bg-black/80" style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border-gold)" }} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setActiveGalleryImg((value) => (value - 1 + gallery.length) % gallery.length);
        if (event.key === "ArrowRight") setActiveGalleryImg((value) => (value + 1) % gallery.length);
      }}>
        <div className="flex items-center justify-between mb-4 gap-4"><span className="font-display text-xl">{room.name}</span><button type="button" onClick={() => galleryDialog.current?.close()} aria-label="Close photo gallery" className="px-3 py-2 text-sm" style={{ color: "var(--gold)" }}>Close ×</button></div>
        <img src={gallery[activeGalleryImg] ?? room.img} alt={`Illustrative photograph ${activeGalleryImg + 1} for ${room.name}`} className="w-full max-h-[65vh] object-contain" />
        <p className="mt-3 text-[11px]" style={{ color: "var(--muted)" }}>Illustrative photography. Actual room interiors may vary.</p>
        <div className="flex items-center justify-between mt-4 text-sm"><button type="button" onClick={() => setActiveGalleryImg((value) => (value - 1 + gallery.length) % gallery.length)} aria-label="Previous photo" className="px-3 py-2" style={{ color: "var(--gold)" }}>← Previous</button><span aria-live="polite">{activeGalleryImg + 1} / {gallery.length}</span><button type="button" onClick={() => setActiveGalleryImg((value) => (value + 1) % gallery.length)} aria-label="Next photo" className="px-3 py-2" style={{ color: "var(--gold)" }}>Next →</button></div>
      </dialog>
      {/* ── BACK LINK ── */}
      <div className="px-6 md:px-10 lg:px-16 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link
          href="/rooms"
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.14em] uppercase transition-colors"
          style={{ color: "var(--muted)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--gold)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--muted)")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All Rooms
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-0">
        {/* ── LEFT COLUMN ── */}
        <div className="flex-1 min-w-0 px-6 md:px-10 lg:px-16 py-8">

          {/* ── PHOTO GALLERY ── */}
          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            {/* Main large photo */}
            <button
              type="button"
              aria-label={`Enlarge ${room.name} photo ${activeGalleryImg + 1}`}
              className="overflow-hidden cursor-pointer min-w-0 shrink-0 w-full sm:w-[52%]"
              style={{ borderRadius: "6px" }}
              onClick={() => galleryDialog.current?.showModal()}
            >
              <img
                src={gallery[activeGalleryImg] ?? room.img}
                alt={`Illustrative photograph for ${room.name}`}
                className="w-full h-[260px] sm:h-full sm:min-h-[320px] sm:max-h-[420px] object-cover transition-transform duration-500 hover:scale-[1.03]"
              />
            </button>

            {/* 2×2 grid */}
            <div
              className="flex-1 min-w-0 grid grid-cols-4 sm:grid-cols-2 gap-3"
              style={{ gridTemplateRows: "1fr 1fr" }}
            >
              {gallery.slice(1, 5).map((img, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={i === 3 ? "Open all room photos" : `Show ${room.name} photo ${i + 2}`}
                  aria-pressed={activeGalleryImg === i + 1}
                  className="overflow-hidden cursor-pointer min-w-0 relative group"
                  style={{ borderRadius: "5px" }}
                  onClick={() => { setActiveGalleryImg(i + 1); if (i === 3) galleryDialog.current?.showModal(); }}
                >
                  <img
                    src={img}
                    alt={`Illustrative photograph ${i + 2} for ${room.name}`}
                    className="w-full h-20 sm:h-full sm:min-h-[130px] sm:max-h-[200px] object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                  />
                  {/* show more overlay on last */}
                  {i === 3 && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.42)" }}
                    >
                      <span className="text-xs text-white tracking-widest">+ More</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] mb-8" style={{ color: "var(--muted)" }}>Illustrative photography. Actual room interiors may vary.</p>

          {/* ── ROOM TITLE ── */}
          <h1
            className="font-display text-4xl md:text-5xl mb-2 leading-tight"
            style={{ color: "var(--fg)" }}
          >
            {room.name}
          </h1>
          {(room.address || room.floor) && <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>{[room.address, room.floor].filter(Boolean).join(" · ")}</p>}

          {/* category tags */}
          <div className="flex flex-wrap gap-2 mb-7">
            {room.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] tracking-[0.12em] uppercase px-4 py-1.5"
                style={{
                  border: "1px solid var(--border-gold)",
                  color: "var(--muted)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* ── HOTEL FEATURES ICONS ── */}
          <div className="mb-7">
            <h3
              className="text-sm font-medium mb-4 tracking-wide"
              style={{ color: "var(--fg)" }}
            >
              Room Information
            </h3>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {room.featureIcons.map((f) => (
                <div key={f.label} className="flex items-center gap-2">
                  <FeatureIcon type={f.icon} />
                  <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                    {f.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="h-px mb-6" style={{ background: "var(--border)" }} />

          {/* ── TABS ── */}
          <div
            role="tablist"
            aria-label="Room information"
            className="flex gap-7 mb-8"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`room-tab-${t.key}`}
                aria-controls={`room-panel-${t.key}`}
                aria-selected={activeTab === t.key}
                tabIndex={activeTab === t.key ? 0 : -1}
                onClick={() => setActiveTab(t.key)}
                onKeyDown={(event) => {
                  const index = TABS.findIndex((tab) => tab.key === t.key);
                  const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index - 1 + TABS.length) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
                  if (next >= 0) { event.preventDefault(); setActiveTab(TABS[next].key); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }
                }}
                className="text-sm pb-3 relative transition-colors duration-200"
                style={{
                  color:
                    activeTab === t.key ? "var(--fg)" : "var(--muted)",
                  fontWeight: activeTab === t.key ? "500" : "400",
                }}
              >
                {t.label}
                {activeTab === t.key && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-[2px]"
                    style={{ background: "var(--gold)" }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* ── TAB CONTENT ── */}
          {activeTab === "description" && (
            <div role="tabpanel" id="room-panel-description" aria-labelledby="room-tab-description" className="max-w-2xl">
              <h2
                className="font-display text-2xl mb-4"
                style={{ color: "var(--fg)" }}
              >
                Your Room
              </h2>
              <p
                className="text-sm leading-relaxed mb-6"
                style={{ color: "var(--muted)" }}
              >
                {room.description}
              </p>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "var(--muted)" }}
              >
                This room type accommodates up to {room.guests} guests. There are {room.totalRooms} rooms in this category, with {room.availableNow} available now. Check your stay dates for a current quote and availability.
              </p>
            </div>
          )}

          {activeTab === "features" && (
            <div role="tabpanel" id="room-panel-features" aria-labelledby="room-tab-features" className="max-w-xl">
              <h2
                className="font-display text-2xl mb-6"
                style={{ color: "var(--fg)" }}
              >
                Room Details
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {room.features_detail.map((feat) => (
                  <div key={feat} className="flex items-center gap-3">
                    <span style={{ color: "var(--gold)" }}>
                      <CheckIcon />
                    </span>
                    <span className="text-sm" style={{ color: "var(--muted)" }}>
                      {feat}
                    </span>
                  </div>
                ))}
                {room.features_detail.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>Additional room details are not available yet.</p>}
              </div>
            </div>
          )}

          {activeTab === "virtual" && (
            <div role="tabpanel" id="room-panel-virtual" aria-labelledby="room-tab-virtual" className="max-w-xl">
              <h2
                className="font-display text-2xl mb-4"
                style={{ color: "var(--fg)" }}
              >
                Virtual Tour
              </h2>
              <div
                className="aspect-video flex flex-col items-center justify-center gap-4"
                style={{
                  background: "var(--bg2)",
                  border: "1px solid var(--border-gold)",
                }}
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ border: "1px solid var(--gold)", color: "var(--gold)" }}
                >
                  <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M10 8l6 4-6 4V8Z" fill="currentColor" />
                  </svg>
                </div>
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  360° Virtual Tour
                </span>
                <span className="text-[10px] tracking-widest uppercase" style={{ color: "var(--dim)" }}>
                  No virtual tour is available for this room.
                </span>
              </div>
            </div>
          )}

          {activeTab === "reviews" && (
            <div role="tabpanel" id="room-panel-reviews" aria-labelledby="room-tab-reviews" className="max-w-2xl space-y-6">
              {room.rating !== null && <div className="flex items-center gap-4 mb-8">
                <div className="font-display text-5xl" style={{ color: "var(--gold)" }}>
                  {room.rating.toFixed(1)}
                </div>
                <div>
                  <div className="flex gap-1 mb-1" style={{ color: "var(--gold)" }}>
                    {[1,2,3,4,5].map((i) => (
                      <StarFilled key={i} filled={i <= Math.round(room.rating ?? 0)} />
                    ))}
                  </div>
                  <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--muted)" }}>
                    {room.reviews.length} guest review{room.reviews.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>}
              {room.reviews.length === 0 && <div className="p-5" style={{ border: "1px solid var(--border)", background: "var(--bg2)" }}><h2 className="font-display text-2xl mb-3" style={{ color: "var(--fg)" }}>Guest Reviews</h2><p className="text-sm" style={{ color: "var(--muted)" }}>Guest reviews are not available for this room type yet.</p></div>}
              {room.reviews.map((rev, i) => (
                <div
                  key={i}
                  className="p-5"
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg2)",
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div
                        className="text-sm font-medium"
                        style={{ color: "var(--fg)" }}
                      >
                        {rev.name}
                      </div>
                      <div
                        className="text-[10px] mt-0.5"
                        style={{ color: "var(--dim)" }}
                      >
                        {rev.country} · {rev.date}
                      </div>
                    </div>
                    <div className="flex gap-0.5" style={{ color: "var(--gold)" }}>
                      {[1,2,3,4,5].map((i) => (
                        <StarFilled key={i} filled={i <= rev.rating} />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                    "{rev.text}"
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div
          className="w-full lg:w-[360px] shrink-0"
          style={{ borderLeft: "1px solid var(--border)" }}
        >
          <div className="lg:sticky lg:top-[64px] lg:max-h-[calc(100vh-64px)] lg:overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            <div className="p-6 space-y-5">

              {/* Base price */}
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-display text-3xl" style={{ color: "var(--fg)" }}>
                    {formatCurrency(room.price, room.currency)}
                  </span>
                  <span className="text-sm ml-2" style={{ color: "var(--muted)" }}>
                    / night
                  </span>
                </div>
                <span
                  className="text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 rounded-full font-medium"
                  style={{ background: "var(--gold)", color: "var(--bg)" }}
                >
                  Base price
                </span>
              </div>

              <div className="h-px" style={{ background: "var(--border)" }} />

              {/* Check In */}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{
                  border: "1px solid var(--border-gold)",
                  background: "var(--bg2)",
                }}
              >
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                  Check In
                </span>
                <input
                  type="date"
                  aria-label="Check-in date"
                  min={businessDate}
                  aria-invalid={!validDates}
                  value={checkIn}
                  onChange={(e) => { const value = e.target.value; setCheckIn(value); if (isCalendarDate(value) && value >= checkOut) setCheckOut(addIsoDays(value, 1)); }}
                  className="bg-transparent text-[11px] outline-none text-right"
                  style={{ color: "var(--fg)" }}
                />
              </div>

              {/* Check Out */}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{
                  border: "1px solid var(--border-gold)",
                  background: "var(--bg2)",
                }}
              >
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                  Check Out
                </span>
                <input
                  type="date"
                  aria-label="Check-out date"
                  min={isCalendarDate(checkIn) ? addIsoDays(checkIn, 1) : addIsoDays(businessDate, 1)}
                  aria-invalid={!validDates}
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="bg-transparent text-[11px] outline-none text-right"
                  style={{ color: "var(--fg)" }}
                />
              </div>

              {/* Adults / Children */}
              <div
                className="px-4 py-3 space-y-3"
                style={{
                  border: "1px solid var(--border-gold)",
                  background: "var(--bg2)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px]" style={{ color: "var(--muted)" }}>Adults</span>
                  <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Remove one adult"
                    disabled={adults <= 1}
                    onClick={() => setAdults((v) => Math.max(1, v - 1))}
                    className="w-5 h-5 flex items-center justify-center text-sm transition-colors"
                    style={{ color: "var(--gold)" }}
                  >
                    −
                  </button>
                  <span className="text-[11px] tabular-nums w-12 text-center" style={{ color: "var(--fg)" }}>
                    {String(adults).padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    aria-label="Add one adult"
                    disabled={adults + children >= room.guests}
                    onClick={() => setAdults((v) => Math.min(room.guests - children, v + 1))}
                    className="w-5 h-5 flex items-center justify-center text-sm transition-colors"
                    style={{ color: "var(--gold)" }}
                  >
                    +
                  </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px]" style={{ color: "var(--muted)" }}>Children</span>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Remove one child" disabled={children <= 0} onClick={() => setChildren((value) => Math.max(0, value - 1))} className="w-5 h-5 flex items-center justify-center text-sm" style={{ color: "var(--gold)" }}>−</button>
                    <span className="text-[11px] tabular-nums w-12 text-center" style={{ color: "var(--fg)" }}>{String(children).padStart(2, "0")}</span>
                    <button type="button" aria-label="Add one child" disabled={adults + children >= room.guests} onClick={() => setChildren((value) => Math.min(room.guests - adults, value + 1))} className="w-5 h-5 flex items-center justify-center text-sm" style={{ color: "var(--gold)" }}>+</button>
                  </div>
                </div>
              </div>

              <div className="h-px" style={{ background: "var(--border)" }} />

              {/* Extra Services */}
              <div>
                <h4 className="text-[11px] font-medium tracking-[0.1em] uppercase mb-3" style={{ color: "var(--fg)" }}>
                  Extra Service
                </h4>
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  Additional services are not available for online booking.
                </p>
              </div>

              {/* Base-price estimate */}
              <div className="p-4 space-y-3" style={{ background: "var(--bg3)", border: "1px solid var(--border)" }}>
                <div className="flex justify-between gap-3 text-[11px]">
                  <span style={{ color: "var(--muted)" }}>Base price / night</span>
                  <span style={{ color: "var(--fg)" }}>{formatCurrency(room.price, room.currency)}</span>
                </div>
                <div className="flex justify-between gap-3 text-[11px]">
                  <span style={{ color: "var(--muted)" }}>Duration</span>
                  <span style={{ color: "var(--fg)" }}>{validDates ? `${nights} night${nights === 1 ? "" : "s"}` : "Choose valid dates"}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-sm font-medium" style={{ color: "var(--fg)" }}>Base-price estimate</span>
                <span className="font-display text-2xl" style={{ color: "var(--fg)" }}>{validDates ? formatCurrency(roomTotal, room.currency) : "—"}</span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>Your final price and available rooms depend on your stay dates. This estimate does not reserve a room or guarantee a price.</p>
              <div className="h-px" style={{ background: "var(--border)" }} />

              {/* Payment */}
              <div>
                <h4 className="text-[11px] font-medium tracking-[0.1em] uppercase mb-3" style={{ color: "var(--fg)" }}>Payment</h4>
                <div className="px-4 py-4 text-[11px] leading-relaxed" style={{ border: "1px solid var(--border-gold)", background: "var(--bg2)", color: "var(--muted)" }}>
                  Payment is arranged after your reservation is confirmed. Continue to review your stay and guest details.
                </div>
                {!validDates && <p role="alert" className="text-[11px] mt-4" style={{ color: "var(--gold)" }}>Choose valid stay dates. Check-in must be on or after {businessDate}, and check-out must follow check-in.</p>}
                <Link href={bookingHref} aria-disabled={!validDates} onClick={(event) => { if (!validDates) event.preventDefault(); }} className="block text-center w-full mt-5 py-3.5 text-[11px] tracking-[0.18em] uppercase font-medium transition-all duration-200" style={{ background: validDates ? "var(--gold)" : "var(--border-gold)", color: validDates ? "var(--bg)" : "var(--dim)", cursor: validDates ? "pointer" : "not-allowed" }}>Check final price and availability</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
