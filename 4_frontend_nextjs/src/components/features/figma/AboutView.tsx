"use client";

import Link from "next/link";

const HERO_BG =
  "https://images.unsplash.com/photo-1609601546193-f558f1ebb385?w=1600&h=900&fit=crop&auto=format";

const VALUES = [
  {
    num: "01",
    title: "Curation Without Compromise",
    body: "A thoughtful stay starts with clear choices. Explore room details, amenities and capacity, then check the rooms available for your dates.",
  },
  {
    num: "02",
    title: "The Art of Anticipation",
    body: "Plan around what matters to you. Compare room information and request a price for your dates; availability and booking details are confirmed in the reservation flow.",
  },
  {
    num: "03",
    title: "Relationships Over Transactions",
    body: "Keep your stay within reach. Your account brings your reservations together, so you can return to the details of a journey you have already planned.",
  },
  {
    num: "04",
    title: "Responsible Luxury",
    body: "Travel with care for the places and people you encounter. Destination stories offer inspiration, while hotel details help you make an informed choice for your stay.",
  },
];

const TIMELINE = [
  { year: "01", event: "Find inspiration in landscapes, cities and quiet escapes from around the world." },
  { year: "02", event: "Explore our hotel's room collection and the amenities that suit your stay." },
  { year: "03", event: "Choose your travel dates and party size to check current room availability." },
  { year: "04", event: "Review the room, dates and price before continuing with your reservation." },
  { year: "05", event: "Sign in to keep your reservation connected to your account." },
  { year: "06", event: "Return to your bookings to review the confirmed details of your stay." },
];

const TEAM = [
  {
    name: "Room to Discover",
    role: "For the Curious",
    img: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&h=300&fit=crop&auto=format",
    quote: "Explore destination stories for the feeling of your next journey. These editorial images are inspiration, not a hotel inventory.",
  },
  {
    name: "Space to Unwind",
    role: "For the Thoughtful",
    img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop&auto=format",
    quote: "Compare the room details that matter to you, from space and capacity to the amenities of your stay.",
  },
  {
    name: "Help Along the Way",
    role: "For Every Guest",
    img: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=300&h=300&fit=crop&auto=format",
    quote: "Request a price for your dates, then review the room, availability and final reservation details before booking.",
  },
];

function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6.5h9M8 3l3.5 3.5L8 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AboutView() {
  return (
    <>
      {/* ── HERO ── */}
      <section className="relative h-[70vh] min-h-[500px] flex items-end overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${HERO_BG})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.92)] via-[rgba(0,0,0,0.3)] to-[rgba(0,0,0,0.15)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(0,0,0,0.55)] to-transparent" />

        <div className="relative z-10 px-5 md:px-10 lg:px-16 pb-14 max-w-4xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              Our Story
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl text-white leading-[0.92] mb-6">
            The Art<br />
            <em className="not-italic" style={{ color: "var(--gold)" }}>of Travel</em>
          </h1>
          <p className="text-sm text-white/55 max-w-md leading-relaxed">
            A thoughtful stay begins with a little inspiration. HotelAI brings room discovery, reservation planning and helpful guidance into one place.
          </p>
        </div>
      </section>

      {/* ── MISSION ── */}
      <section
        className="px-5 md:px-10 lg:px-16 py-24"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-28 items-start">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-8" style={{ background: "var(--gold)" }} />
              <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
                What We Believe
              </span>
            </div>
            <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-8" style={{ color: "var(--fg)" }}>
              Travel isn't a service.<br />It's a language.
            </h2>
            <div className="space-y-5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              <p>
                When you stand at the edge of the Maldivian atoll at 5:47am, before the world wakes — that is not a room you booked. That is a moment that rewrites something in you.
              </p>
              <p>
                HotelAI helps you turn the idea of a stay into a clear plan. Explore our hotel's rooms, compare the details, and find the space that feels right for you.
              </p>
              <p>
                The destinations and travel imagery on this site are editorial inspiration. Reservations are available from our hotel's room collection; check your dates to see current availability and pricing.
              </p>
            </div>
          </div>

          <div>
            <div
              className="aspect-[4/5] overflow-hidden mb-5"
              style={{ borderRadius: "9999px 9999px 6px 6px" }}
            >
              <img
                src="https://images.unsplash.com/photo-1586861642026-74a6da22a3cd?w=700&h=875&fit=crop&auto=format"
                alt="Maldives overwater view"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { v: "Discover", l: "Room Collection" },
                { v: "Plan", l: "Check Your Dates" },
                { v: "Quote", l: "Stay Pricing" },
                { v: "Return", l: "Your Reservations" },
              ].map((s) => (
                <div key={s.l} className="p-4" style={{ border: "1px solid var(--border-gold)" }}>
                  <div className="font-display text-2xl" style={{ color: "var(--gold)" }}>{s.v}</div>
                  <div className="text-[10px] uppercase tracking-wider mt-1" style={{ color: "var(--muted)" }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── VALUES ── */}
      <section
        className="py-24"
        style={{ background: "var(--bg2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="px-5 md:px-10 lg:px-16">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              Our Philosophy
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-14" style={{ color: "var(--fg)" }}>
            Four pillars.<br />One standard.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ background: "var(--border)" }}>
            {VALUES.map((v) => (
              <div
                key={v.num}
                className="p-8 transition-all duration-300 group"
                style={{ background: "var(--bg2)" }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "var(--card-hover)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "var(--bg2)")
                }
              >
                <div className="font-display text-5xl mb-5 leading-none" style={{ color: "rgba(196,153,90,0.12)" }}>
                  {v.num}
                </div>
                <h3 className="font-display text-xl mb-4" style={{ color: "var(--fg)" }}>
                  {v.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                  {v.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TIMELINE ── */}
      <section className="px-5 md:px-10 lg:px-16 py-24">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px w-8" style={{ background: "var(--gold)" }} />
          <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
            Your Journey
          </span>
        </div>
        <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-14" style={{ color: "var(--fg)" }}>
          From inspiration to arrival
        </h2>

        <div className="relative">
          {/* vertical line */}
          <div
            className="absolute left-[90px] md:left-[120px] top-0 bottom-0 w-px hidden sm:block"
            style={{ background: "var(--border)" }}
          />
          <div className="space-y-0">
            {TIMELINE.map((t, i) => (
              <div key={t.year} className="flex items-start gap-8 sm:gap-16 py-7" style={{ borderBottom: i < TIMELINE.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div
                  className="shrink-0 font-display text-2xl w-[90px] md:w-[120px] text-right pr-8 relative"
                  style={{ color: "var(--gold)" }}
                >
                  {t.year}
                  {/* dot */}
                  <div
                    className="absolute right-0 top-3 w-2 h-2 rounded-full translate-x-1 hidden sm:block"
                    style={{ background: "var(--gold)" }}
                  />
                </div>
                <p className="text-sm leading-relaxed pt-1" style={{ color: "var(--muted)" }}>
                  {t.event}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TEAM ── */}
      <section
        className="py-24"
        style={{ background: "var(--bg2)", borderTop: "1px solid var(--border)" }}
      >
        <div className="px-5 md:px-10 lg:px-16">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              The Guest Experience
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-14" style={{ color: "var(--fg)" }}>
            Obsessed with<br />the details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {TEAM.map((member) => (
              <div key={member.name} className="group">
                <div className="overflow-hidden mb-6" style={{ borderRadius: "9999px 9999px 6px 6px" }}>
                  <div className="aspect-[3/4]">
                    <img
                      src={member.img}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                    />
                  </div>
                </div>
                <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: "var(--gold)" }}>
                  {member.role}
                </div>
                <h3 className="font-display text-xl mb-3" style={{ color: "var(--fg)" }}>{member.name}</h3>
                <p className="text-sm italic leading-relaxed" style={{ color: "var(--muted)" }}>
                  {member.quote}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-5 md:px-10 lg:px-16 py-24 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="font-display text-7xl leading-none mb-2 select-none" style={{ color: "rgba(196,153,90,0.08)" }}>"</div>
          <blockquote className="font-display text-2xl md:text-3xl italic leading-snug -mt-5 mb-10" style={{ color: "var(--fg)" }}>
            The world is too extraordinary to explore it mediocrely.
          </blockquote>
          <div className="text-[9px] tracking-[0.2em] uppercase mb-10" style={{ color: "var(--dim)" }}>
            — Our Travel Philosophy
          </div>
          <Link
            href="/book"
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase px-10 py-4 transition-all duration-300"
            style={{ background: "var(--gold)", color: "var(--bg)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
          >
            Begin Your Journey <ArrowRight />
          </Link>
        </div>
      </section>
    </>
  );
}
