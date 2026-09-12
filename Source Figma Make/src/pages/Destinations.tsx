import { useState } from "react";
import { Link } from "react-router";
import { destinations, REGIONS } from "@/data";

function StarIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
      <path d="M5 0.5L6.18 3.68L9.51 3.9L6.89 6.12L7.74 9.37L5 7.6L2.26 9.37L3.11 6.12L0.49 3.9L3.82 3.68L5 0.5Z" />
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

const SORTS = ["Recommended", "Price: Low", "Price: High", "Top Rated"];

export default function Destinations() {
  const [region, setRegion] = useState("All");
  const [sort, setSort] = useState("Recommended");
  const [featured, setFeatured] = useState(destinations[0]);
  const [view, setView] = useState<"grid" | "list">("grid");

  const filtered = destinations.filter(
    (d) => region === "All" || d.region === region
  );
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "Price: Low") return parseInt(a.price.slice(1)) - parseInt(b.price.slice(1));
    if (sort === "Price: High") return parseInt(b.price.slice(1)) - parseInt(a.price.slice(1));
    if (sort === "Top Rated") return b.rating - a.rating;
    return 0;
  });

  return (
    <>
      {/* ── HERO ── */}
      <section
        className="relative h-[56vh] min-h-[420px] flex flex-col justify-end overflow-hidden"
      >
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-700"
          style={{ backgroundImage: `url(${featured.imgWide})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.92)] via-[rgba(0,0,0,0.35)] to-[rgba(0,0,0,0.2)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(0,0,0,0.55)] to-transparent" />

        <div className="relative z-10 px-5 md:px-10 lg:px-16 pb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              {featured.region}
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-6xl text-white leading-[0.95] mb-3">
            {featured.name}
          </h1>
          <p className="text-sm text-white/55 max-w-md leading-relaxed">
            {featured.description}
          </p>
          <div className="flex items-center gap-6 mt-5">
            <div className="flex items-center gap-1.5" style={{ color: "var(--gold)" }}>
              <StarIcon />
              <span className="text-xs text-white/70">{featured.rating} · {featured.reviews} reviews</span>
            </div>
            <span className="text-xs text-white/40">from <span className="text-white/80 font-medium">{featured.price}</span>/night</span>
          </div>
        </div>
      </section>

      {/* ── CONTROLS ── */}
      <div
        className="sticky top-[60px] z-30 px-5 md:px-10 lg:px-16 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}
      >
        {/* region tabs */}
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className="text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 transition-all duration-200"
              style={{
                border: `1px solid ${region === r ? "var(--gold)" : "var(--border-gold)"}`,
                background: region === r ? "rgba(196,153,90,0.1)" : "transparent",
                color: region === r ? "var(--gold)" : "var(--muted)",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 outline-none cursor-pointer"
            style={{
              background: "var(--bg2)",
              border: "1px solid var(--border-gold)",
              color: "var(--muted)",
            }}
          >
            {SORTS.map((s) => <option key={s}>{s}</option>)}
          </select>
          {/* view toggle */}
          <div className="flex" style={{ border: "1px solid var(--border-gold)" }}>
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-3 py-1.5 text-[10px] transition-all duration-200"
                style={{
                  background: view === v ? "rgba(196,153,90,0.12)" : "transparent",
                  color: view === v ? "var(--gold)" : "var(--muted)",
                  borderRight: v === "grid" ? "1px solid var(--border-gold)" : "none",
                }}
              >
                {v === "grid" ? "⊞" : "≡"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── DESTINATION CARDS ── */}
      <section className="px-5 md:px-10 lg:px-16 py-16" style={{ minHeight: "60vh" }}>
        <div className="mb-6 flex items-center justify-between">
          <span className="text-[10px] tracking-wider" style={{ color: "var(--muted)" }}>
            {sorted.length} destination{sorted.length !== 1 ? "s" : ""} found
          </span>
        </div>

        {view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {sorted.map((dest) => (
              <div
                key={dest.id}
                className="group cursor-pointer"
                onMouseEnter={() => setFeatured(dest)}
              >
                <div
                  className="relative overflow-hidden"
                  style={{ borderRadius: "9999px 9999px 6px 6px" }}
                >
                  <div className="aspect-[3/4]">
                    <img
                      src={dest.img}
                      alt={dest.name}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.88)] via-transparent to-transparent" />
                  </div>
                  {/* country badge */}
                  <div
                    className="absolute top-5 left-1/2 -translate-x-1/2 text-[9px] tracking-[0.18em] uppercase px-3 py-1 backdrop-blur-md"
                    style={{ background: "rgba(0,0,0,0.45)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    {dest.country}
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color: "var(--gold)" }}>
                        {dest.tagline}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-white/60">
                        <StarIcon /> {dest.rating}
                      </span>
                    </div>
                    <h3 className="font-display text-xl text-white">{dest.name}</h3>
                    <div
                      className="flex items-center justify-between mt-3 pt-3"
                      style={{ borderTop: "1px solid rgba(196,153,90,0.18)" }}
                    >
                      <span className="text-[11px] text-white/50">
                        from <span className="text-white/90 font-medium">{dest.price}</span>/night
                      </span>
                      <span className="text-[9px] text-white/30 uppercase tracking-wider">{dest.nights}n</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex gap-1">
                    {dest.highlights.slice(0, 2).map((h) => (
                      <span
                        key={h}
                        className="text-[8px] tracking-wider uppercase px-2 py-0.5"
                        style={{ border: "1px solid var(--border-gold)", color: "var(--dim)" }}
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                  <Link
                    to="/book"
                    className="text-[10px] tracking-[0.15em] uppercase flex items-center gap-1 transition-colors"
                    style={{ color: "var(--gold)" }}
                  >
                    Book <ArrowRight />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {sorted.map((dest) => (
              <div
                key={dest.id}
                className="group flex gap-6 p-5 transition-all duration-200 cursor-pointer"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--bg2)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border-gold)";
                  setFeatured(dest);
                }}
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.borderColor = "var(--border)")
                }
              >
                <div className="shrink-0 w-36 h-28 overflow-hidden rounded-sm">
                  <img
                    src={dest.img}
                    alt={dest.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.08]"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: "var(--gold)" }}>
                        {dest.region} · {dest.country}
                      </div>
                      <h3 className="font-display text-xl mb-1" style={{ color: "var(--fg)" }}>{dest.name}</h3>
                      <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "var(--muted)" }}>
                        {dest.description}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-display text-xl" style={{ color: "var(--gold)" }}>{dest.price}</div>
                      <div className="text-[9px]" style={{ color: "var(--dim)" }}>/night</div>
                      <Link
                        to="/book"
                        className="mt-3 inline-block text-[9px] tracking-[0.16em] uppercase px-4 py-2 transition-all"
                        style={{ border: "1px solid var(--gold)", color: "var(--gold)" }}
                      >
                        Book Now
                      </Link>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--gold)" }}>
                      <StarIcon />
                      <span style={{ color: "var(--muted)" }}>{dest.rating} · {dest.reviews} reviews</span>
                    </span>
                    <span className="text-[9px]" style={{ color: "var(--dim)" }}>·</span>
                    <span className="text-[9px]" style={{ color: "var(--dim)" }}>{dest.nights} nights recommended</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="font-display text-5xl mb-4" style={{ color: "var(--border-gold)" }}>∅</div>
            <p className="text-sm" style={{ color: "var(--muted)" }}>No destinations match this filter.</p>
            <button
              onClick={() => setRegion("All")}
              className="mt-6 text-[10px] tracking-[0.16em] uppercase px-6 py-2 transition-all"
              style={{ border: "1px solid var(--gold)", color: "var(--gold)" }}
            >
              Clear Filter
            </button>
          </div>
        )}
      </section>

      {/* ── FEATURED WIDE ── */}
      <section
        className="px-5 md:px-10 lg:px-16 py-16"
        style={{ background: "var(--bg2)", borderTop: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 mb-10">
          <div className="h-px w-8" style={{ background: "var(--gold)" }} />
          <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
            Editor's Choice
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {destinations.slice(0, 2).map((dest, i) => (
            <div
              key={dest.id}
              className="relative overflow-hidden group cursor-pointer"
              style={{ minHeight: "320px" }}
            >
              <img
                src={dest.imgWide}
                alt={dest.name}
                className="w-full h-full object-cover absolute inset-0 transition-transform duration-700 group-hover:scale-[1.04]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.82)] via-[rgba(0,0,0,0.2)] to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[rgba(0,0,0,0.35)] to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-7">
                <div className="text-[9px] tracking-[0.22em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                  {dest.tagline}
                </div>
                <h3 className="font-display text-3xl text-white mb-3">{dest.name}</h3>
                <p className="text-[11px] text-white/55 max-w-sm leading-relaxed mb-5 line-clamp-2">
                  {dest.description}
                </p>
                <div className="flex items-center gap-5">
                  <div>
                    <span className="font-display text-2xl" style={{ color: "var(--gold)" }}>{dest.price}</span>
                    <span className="text-xs text-white/40 ml-1">/night</span>
                  </div>
                  <Link
                    to="/book"
                    className="text-[10px] tracking-[0.16em] uppercase px-6 py-2.5 transition-all duration-200"
                    style={{ background: "var(--gold)", color: "var(--bg)" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
                  >
                    Book This Escape
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
