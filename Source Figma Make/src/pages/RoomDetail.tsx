import { useState } from "react";
import { Link, useParams, Navigate } from "react-router";
import { rooms } from "@/data";

type TabKey = "description" | "features" | "virtual" | "reviews";

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

export default function RoomDetail() {
  const { id } = useParams<{ id: string }>();
  const room = rooms.find((r) => r.id === Number(id));
  if (!room) return <Navigate to="/rooms" replace />;

  const [activeTab, setActiveTab] = useState<TabKey>("description");
  const [activeGalleryImg, setActiveGalleryImg] = useState(0);
  const [checkIn, setCheckIn] = useState("2026-10-14");
  const [checkOut, setCheckOut] = useState("2026-10-19");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(2);
  const [extras, setExtras] = useState<Record<string, boolean>>(
    Object.fromEntries(room.extraServices.map((s) => [s.id, s.defaultOn]))
  );
  const [payMethod, setPayMethod] = useState("VISA");
  const [cardNum, setCardNum] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardMM, setCardMM] = useState("");
  const [cardCVV, setCardCVV] = useState("");
  const [cardCountry, setCardCountry] = useState("France");
  const [agree, setAgree] = useState(false);

  const nights = Math.max(
    1,
    Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );

  const activeExtras = room.extraServices.filter((s) => extras[s.id] && s.price > 0);
  const extrasTotal = activeExtras.reduce((sum, s) => sum + s.price * nights, 0);
  const roomTotal = room.price * nights;
  const serviceFee = 100;
  const discountAmt = Math.round((roomTotal + extrasTotal) * (room.discount / 100));
  const grandTotal = roomTotal + extrasTotal + serviceFee - discountAmt;

  const TABS: { key: TabKey; label: string }[] = [
    { key: "description", label: "Description" },
    { key: "features", label: "Features" },
    { key: "virtual", label: "Virtual" },
    { key: "reviews", label: "Reviews" },
  ];

  return (
    <div className="pt-20" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {/* ── BACK LINK ── */}
      <div className="px-6 md:px-10 lg:px-16 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link
          to="/rooms"
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
          <div className="flex gap-3 mb-8">
            {/* Main large photo */}
            <div
              className="overflow-hidden cursor-pointer shrink-0"
              style={{ width: "52%", borderRadius: "6px" }}
              onClick={() => setActiveGalleryImg(0)}
            >
              <img
                src={room.gallery[0]}
                alt={room.name}
                className="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                style={{ minHeight: "320px", maxHeight: "420px" }}
              />
            </div>

            {/* 2×2 grid */}
            <div
              className="flex-1 grid grid-cols-2 gap-3"
              style={{ gridTemplateRows: "1fr 1fr" }}
            >
              {room.gallery.slice(1, 5).map((img, i) => (
                <div
                  key={i}
                  className="overflow-hidden cursor-pointer relative group"
                  style={{ borderRadius: "5px" }}
                  onClick={() => setActiveGalleryImg(i + 1)}
                >
                  <img
                    src={img}
                    alt={`${room.name} view ${i + 2}`}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                    style={{ minHeight: "130px", maxHeight: "200px" }}
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
                </div>
              ))}
            </div>
          </div>

          {/* ── ROOM TITLE ── */}
          <h1
            className="font-display text-4xl md:text-5xl mb-2 leading-tight"
            style={{ color: "var(--fg)" }}
          >
            {room.name}
          </h1>
          <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
            {room.address} · {room.floor}
          </p>

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
              Hotel Features
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
            className="flex gap-7 mb-8"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
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
            <div className="max-w-2xl">
              <h2
                className="font-display text-2xl mb-4"
                style={{ color: "var(--fg)" }}
              >
                Our Suite
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
                Every morning begins with curated amenities delivered to your door. Every evening, the room is transformed — bedding turned, surfaces refreshed, and a selection of artisan chocolates placed on your pillow. This is not hospitality. This is an art form.
              </p>
            </div>
          )}

          {activeTab === "features" && (
            <div className="max-w-xl">
              <h2
                className="font-display text-2xl mb-6"
                style={{ color: "var(--fg)" }}
              >
                Room Amenities
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
              </div>
            </div>
          )}

          {activeTab === "virtual" && (
            <div className="max-w-xl">
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
                  Coming Soon
                </span>
              </div>
            </div>
          )}

          {activeTab === "reviews" && (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center gap-4 mb-8">
                <div className="font-display text-5xl" style={{ color: "var(--gold)" }}>
                  {room.rating.toFixed(1)}
                </div>
                <div>
                  <div className="flex gap-1 mb-1" style={{ color: "var(--gold)" }}>
                    {[1,2,3,4,5].map((i) => (
                      <StarFilled key={i} filled={i <= Math.round(room.rating)} />
                    ))}
                  </div>
                  <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--muted)" }}>
                    {room.reviews.length} guest review{room.reviews.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
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
          <div className="lg:sticky lg:top-[64px] max-h-[calc(100vh-64px)] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            <div className="p-6 space-y-5">

              {/* price + discount badge */}
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="font-display text-4xl" style={{ color: "var(--fg)" }}>
                    ${room.price}
                  </span>
                  <span className="text-sm ml-2" style={{ color: "var(--muted)" }}>
                    / Night
                  </span>
                </div>
                <span
                  className="text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 rounded-full font-medium"
                  style={{ background: "var(--gold)", color: "var(--bg)" }}
                >
                  {room.discount}% OFF
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
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="bg-transparent text-[11px] outline-none text-right [color-scheme:dark]"
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
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="bg-transparent text-[11px] outline-none text-right [color-scheme:dark]"
                  style={{ color: "var(--fg)" }}
                />
              </div>

              {/* Adults / Children */}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{
                  border: "1px solid var(--border-gold)",
                  background: "var(--bg2)",
                }}
              >
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                  Adults/Children
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAdults((v) => Math.max(1, v - 1))}
                    className="w-5 h-5 flex items-center justify-center text-sm transition-colors"
                    style={{ color: "var(--gold)" }}
                  >
                    −
                  </button>
                  <span className="text-[11px] tabular-nums w-12 text-center" style={{ color: "var(--fg)" }}>
                    {String(adults).padStart(2, "0")}/{String(children).padStart(2, "0")}
                  </span>
                  <button
                    onClick={() => setAdults((v) => Math.min(room.guests, v + 1))}
                    className="w-5 h-5 flex items-center justify-center text-sm transition-colors"
                    style={{ color: "var(--gold)" }}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="h-px" style={{ background: "var(--border)" }} />

              {/* Extra Services */}
              <div>
                <h4 className="text-[11px] font-medium tracking-[0.1em] uppercase mb-3" style={{ color: "var(--fg)" }}>
                  Extra Service
                </h4>
                <div className="space-y-3">
                  {room.extraServices.map((svc) => (
                    <label
                      key={svc.id}
                      className="flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        {/* checkbox */}
                        <div
                          className="w-4 h-4 flex items-center justify-center shrink-0 transition-all duration-200"
                          style={{
                            border: `1.5px solid ${extras[svc.id] ? "var(--gold)" : "var(--border-gold)"}`,
                            background: extras[svc.id] ? "var(--gold)" : "transparent",
                            color: "var(--bg)",
                            borderRadius: "2px",
                          }}
                          onClick={() =>
                            setExtras((e) => ({ ...e, [svc.id]: !e[svc.id] }))
                          }
                        >
                          {extras[svc.id] && <CheckIcon />}
                        </div>
                        <span className="text-[11px]" style={{ color: extras[svc.id] ? "var(--fg)" : "var(--muted)" }}>
                          {svc.label}
                        </span>
                      </div>
                      <span className="text-[11px] shrink-0" style={{ color: svc.price === 0 ? "var(--muted)" : "var(--fg)" }}>
                        {svc.price === 0
                          ? `$0/${svc.unit}`
                          : `$${svc.price}/${svc.unit}`}
                        {svc.price > 0 && (
                          <span style={{ color: "var(--dim)" }}> ↓</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Price breakdown */}
              <div
                className="p-4 space-y-2"
                style={{
                  background: "var(--bg3)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: "var(--muted)" }}>{nights} Night{nights > 1 ? "s" : ""}</span>
                  <span style={{ color: "var(--fg)" }}>${roomTotal.toLocaleString()}</span>
                </div>
                {activeExtras.map((svc) => (
                  <div key={svc.id} className="flex justify-between text-[11px]">
                    <span style={{ color: "var(--muted)" }}>{svc.label}</span>
                    <span style={{ color: "var(--fg)" }}>${(svc.price * nights).toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: "var(--muted)" }}>Service fee</span>
                  <span style={{ color: "var(--fg)" }}>${serviceFee}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: "var(--muted)" }}>Discount</span>
                  <span style={{ color: "var(--gold)" }}>{room.discount}%</span>
                </div>
              </div>

              {/* Total */}
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium" style={{ color: "var(--fg)" }}>
                  Total Cost:
                </span>
                <span className="font-display text-3xl" style={{ color: "var(--fg)" }}>
                  ${grandTotal.toLocaleString()}
                </span>
              </div>

              <div className="h-px" style={{ background: "var(--border)" }} />

              {/* Payment */}
              <div>
                <h4 className="text-[11px] font-medium tracking-[0.1em] uppercase mb-3" style={{ color: "var(--fg)" }}>
                  Payment
                </h4>
                {/* method pills */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {["VISA", "AMEX", "STRIPE", "G PAY", "···"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setPayMethod(m)}
                      className="text-[10px] tracking-wider px-3 py-1.5 transition-all duration-150"
                      style={{
                        border: `1px solid ${payMethod === m ? "var(--gold)" : "var(--border-gold)"}`,
                        background: payMethod === m ? "rgba(196,153,90,0.1)" : "transparent",
                        color: payMethod === m ? "var(--gold)" : "var(--muted)",
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {/* card inputs */}
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Card Number"
                    value={cardNum}
                    onChange={(e) => setCardNum(e.target.value)}
                    maxLength={19}
                    className="w-full bg-transparent text-[11px] px-4 py-3 outline-none placeholder:opacity-40"
                    style={{
                      border: "1px solid var(--border-gold)",
                      color: "var(--fg)",
                      background: "var(--bg2)",
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Cardholder Name"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    className="w-full bg-transparent text-[11px] px-4 py-3 outline-none placeholder:opacity-40"
                    style={{
                      border: "1px solid var(--border-gold)",
                      color: "var(--fg)",
                      background: "var(--bg2)",
                    }}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="MM/YY"
                      value={cardMM}
                      onChange={(e) => setCardMM(e.target.value)}
                      maxLength={5}
                      className="bg-transparent text-[11px] px-3 py-3 outline-none placeholder:opacity-40"
                      style={{
                        border: "1px solid var(--border-gold)",
                        color: "var(--fg)",
                        background: "var(--bg2)",
                      }}
                    />
                    <input
                      type="text"
                      placeholder="CVV"
                      value={cardCVV}
                      onChange={(e) => setCardCVV(e.target.value)}
                      maxLength={4}
                      className="bg-transparent text-[11px] px-3 py-3 outline-none placeholder:opacity-40"
                      style={{
                        border: "1px solid var(--border-gold)",
                        color: "var(--fg)",
                        background: "var(--bg2)",
                      }}
                    />
                    <select
                      value={cardCountry}
                      onChange={(e) => setCardCountry(e.target.value)}
                      className="bg-transparent text-[11px] px-2 py-3 outline-none"
                      style={{
                        border: "1px solid var(--border-gold)",
                        color: "var(--fg)",
                        background: "var(--bg2)",
                      }}
                    >
                      {["France", "USA", "UK", "Germany", "Japan", "Singapore", "Australia", "UAE"].map(
                        (c) => <option key={c} value={c} style={{ background: "var(--bg2)" }}>{c}</option>
                      )}
                    </select>
                  </div>
                </div>

                {/* agree checkbox */}
                <label className="flex items-start gap-3 mt-4 cursor-pointer">
                  <div
                    className="w-4 h-4 flex items-center justify-center mt-0.5 shrink-0 transition-all duration-200"
                    style={{
                      border: `1.5px solid ${agree ? "var(--gold)" : "var(--border-gold)"}`,
                      background: agree ? "var(--gold)" : "transparent",
                      color: "var(--bg)",
                      borderRadius: "2px",
                    }}
                    onClick={() => setAgree((v) => !v)}
                  >
                    {agree && <CheckIcon />}
                  </div>
                  <span className="text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
                    By clicking Pay Now I agree to the{" "}
                    <a href="#" style={{ color: "var(--gold)" }}>Reservation</a>{" "}
                    And{" "}
                    <a href="#" style={{ color: "var(--gold)" }}>Cancellation</a>{" "}
                    policies
                  </span>
                </label>

                {/* Pay Now button */}
                <button
                  className="w-full mt-5 py-3.5 text-[11px] tracking-[0.18em] uppercase font-medium transition-all duration-200"
                  style={{
                    background: agree ? "var(--gold)" : "var(--border-gold)",
                    color: agree ? "var(--bg)" : "var(--dim)",
                    cursor: agree ? "pointer" : "not-allowed",
                  }}
                  onClick={() => agree && alert("Booking confirmed!")}
                >
                  Pay Now
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
