import { useState } from "react";
import { destinations, rooms } from "@/data";

type Step = 1 | 2 | 3 | 4;

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

const STEPS = [
  { n: 1, label: "Escape" },
  { n: 2, label: "Room" },
  { n: 3, label: "Details" },
  { n: 4, label: "Confirm" },
];

export default function Book() {
  const [step, setStep] = useState<Step>(1);
  const [selectedDest, setSelectedDest] = useState(destinations[0]);
  const [selectedRoom, setSelectedRoom] = useState(rooms[0]);
  const [checkIn, setCheckIn] = useState("2026-10-14");
  const [checkOut, setCheckOut] = useState("2026-10-19");
  const [guests, setGuests] = useState(2);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    country: "",
    requests: "",
    newsletter: false,
  });
  const [submitted, setSubmitted] = useState(false);

  const nights = Math.max(
    1,
    Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );
  const roomTotal = selectedRoom.price * nights;
  const tax = Math.round(roomTotal * 0.12);
  const serviceFee = 45;
  const grandTotal = roomTotal + tax + serviceFee;

  const goNext = () => setStep((s) => Math.min(4, s + 1) as Step);
  const goBack = () => setStep((s) => Math.max(1, s - 1) as Step);

  const handleSubmit = () => {
    setSubmitted(true);
    setStep(4);
  };

  return (
    <>
      {/* ── HEADER ── */}
      <section className="pt-24 pb-10 px-5 md:px-10 lg:px-16" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px w-8" style={{ background: "var(--gold)" }} />
          <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
            Reserve Your Escape
          </span>
        </div>
        <h1 className="font-display text-4xl md:text-5xl" style={{ color: "var(--fg)" }}>
          Begin Your Journey
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

          {/* STEP 1: Choose destination */}
          {step === 1 && (
            <div>
              <h2 className="font-display text-3xl mb-2" style={{ color: "var(--fg)" }}>
                Choose your escape
              </h2>
              <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
                Select a destination and set your travel dates.
              </p>

              {/* dates */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8 p-6" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                <div>
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Check In
                  </label>
                  <input
                    type="date"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="w-full bg-transparent text-sm outline-none pb-2 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid var(--border-gold)", color: "var(--fg)" }}
                  />
                </div>
                <div>
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Check Out
                  </label>
                  <input
                    type="date"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full bg-transparent text-sm outline-none pb-2 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid var(--border-gold)", color: "var(--fg)" }}
                  />
                </div>
                <div>
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Guests
                  </label>
                  <div className="flex items-center gap-3 pb-2" style={{ borderBottom: "1px solid var(--border-gold)" }}>
                    <button onClick={() => setGuests((g) => Math.max(1, g - 1))} className="text-lg leading-none" style={{ color: "var(--gold)" }}>−</button>
                    <span className="text-sm tabular-nums" style={{ color: "var(--fg)" }}>{guests}</span>
                    <button onClick={() => setGuests((g) => g + 1)} className="text-lg leading-none" style={{ color: "var(--gold)" }}>+</button>
                  </div>
                </div>
              </div>

              {/* destination grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {destinations.slice(0, 6).map((dest) => {
                  const sel = selectedDest.id === dest.id;
                  return (
                    <div
                      key={dest.id}
                      className="flex gap-4 p-4 cursor-pointer transition-all duration-200"
                      style={{
                        border: `1px solid ${sel ? "var(--gold)" : "var(--border)"}`,
                        background: sel ? "rgba(196,153,90,0.06)" : "var(--bg2)",
                      }}
                      onClick={() => setSelectedDest(dest)}
                    >
                      <div className="w-20 h-16 overflow-hidden shrink-0 rounded-sm">
                        <img src={dest.img} alt={dest.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] tracking-widest uppercase mb-0.5" style={{ color: "var(--gold)" }}>
                          {dest.region}
                        </div>
                        <div className="font-display text-base" style={{ color: "var(--fg)" }}>{dest.name}</div>
                        <div className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>from {dest.price}/night</div>
                      </div>
                      {sel && (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 self-center" style={{ background: "var(--gold)", color: "var(--bg)" }}>
                          <CheckIcon />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Choose room */}
          {step === 2 && (
            <div>
              <h2 className="font-display text-3xl mb-2" style={{ color: "var(--fg)" }}>
                Choose your room
              </h2>
              <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
                {nights} nights · {guests} guest{guests > 1 ? "s" : ""} · {selectedDest.name}
              </p>
              <div className="flex flex-col gap-4">
                {rooms.map((room) => {
                  const sel = selectedRoom.id === room.id;
                  const available = room.guests >= guests;
                  return (
                    <div
                      key={room.id}
                      className={`flex gap-0 transition-all duration-200 overflow-hidden ${available ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
                      style={{
                        border: `1px solid ${sel ? "var(--gold)" : "var(--border)"}`,
                        background: sel ? "rgba(196,153,90,0.05)" : "var(--bg2)",
                      }}
                      onClick={() => available && setSelectedRoom(room)}
                    >
                      <div className="w-36 shrink-0 overflow-hidden">
                        <img src={room.img} alt={room.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 p-5 flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[9px] tracking-widest uppercase mb-1" style={{ color: sel ? "var(--gold)" : "var(--dim)" }}>
                            {room.category}
                          </div>
                          <div className="font-display text-lg mb-1" style={{ color: "var(--fg)" }}>{room.name}</div>
                          <div className="text-[10px] mb-3" style={{ color: "var(--muted)" }}>
                            {room.type} · {room.sqm}m² · max {room.guests} guests
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {room.features.slice(0, 3).map((f) => (
                              <span key={f} className="text-[8px] uppercase tracking-wider px-2 py-0.5" style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}>{f}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-display text-xl" style={{ color: "var(--gold)" }}>${room.price}</div>
                          <div className="text-[9px]" style={{ color: "var(--dim)" }}>/night</div>
                          <div className="font-display text-sm mt-1" style={{ color: "var(--muted)" }}>
                            ${room.price * nights} total
                          </div>
                        </div>
                      </div>
                      {sel && (
                        <div className="w-10 flex items-center justify-center shrink-0" style={{ background: "var(--gold)", color: "var(--bg)" }}>
                          <CheckIcon />
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
              <h2 className="font-display text-3xl mb-2" style={{ color: "var(--fg)" }}>
                Guest details
              </h2>
              <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
                All fields marked with * are required.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
                {[
                  { key: "firstName", label: "First Name *", placeholder: "Isabelle" },
                  { key: "lastName", label: "Last Name *", placeholder: "Marceau" },
                  { key: "email", label: "Email Address *", placeholder: "isabelle@example.com" },
                  { key: "phone", label: "Phone Number", placeholder: "+33 6 00 00 00 00" },
                  { key: "country", label: "Country of Residence *", placeholder: "France" },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                      {field.label}
                    </label>
                    <input
                      type="text"
                      placeholder={field.placeholder}
                      value={(form as any)[field.key]}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                      className="w-full bg-transparent text-sm outline-none pb-2 placeholder:opacity-25"
                      style={{
                        borderBottom: "1px solid var(--border-gold)",
                        color: "var(--fg)",
                      }}
                    />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Special Requests
                  </label>
                  <textarea
                    placeholder="Dietary requirements, room preferences, celebratory arrangements..."
                    value={form.requests}
                    onChange={(e) => setForm((f) => ({ ...f, requests: e.target.value }))}
                    rows={4}
                    className="w-full bg-transparent text-sm outline-none resize-none placeholder:opacity-25 pt-2"
                    style={{
                      border: "1px solid var(--border-gold)",
                      color: "var(--fg)",
                      padding: "12px",
                    }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div
                      className="w-5 h-5 flex items-center justify-center transition-all duration-200"
                      style={{
                        border: `1px solid ${form.newsletter ? "var(--gold)" : "var(--border-gold)"}`,
                        background: form.newsletter ? "var(--gold)" : "transparent",
                        color: "var(--bg)",
                      }}
                      onClick={() => setForm((f) => ({ ...f, newsletter: !f.newsletter }))}
                    >
                      {form.newsletter && <CheckIcon />}
                    </div>
                    <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                      Subscribe to curated travel inspiration from Aurum
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Confirmation */}
          {step === 4 && (
            <div>
              {submitted ? (
                <div className="py-10 max-w-lg">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-8" style={{ border: "1px solid var(--gold)", color: "var(--gold)" }}>
                    <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h2 className="font-display text-4xl mb-4" style={{ color: "var(--fg)" }}>
                    Reservation Received
                  </h2>
                  <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--muted)" }}>
                    Thank you for choosing Aurum. Your dedicated travel curator will contact you within 2 hours to confirm your booking and discuss any personal touches.
                  </p>
                  <div className="p-5 mb-8" style={{ border: "1px solid var(--border-gold)", background: "rgba(196,153,90,0.05)" }}>
                    <div className="text-[9px] tracking-[0.2em] uppercase mb-3" style={{ color: "var(--gold)" }}>
                      Booking Reference
                    </div>
                    <div className="font-display text-3xl" style={{ color: "var(--fg)" }}>
                      AUR-{Math.floor(Math.random() * 90000) + 10000}
                    </div>
                    <div className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
                      {selectedDest.name} · {selectedRoom.name} · {nights} nights
                    </div>
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--dim)" }}>
                    A confirmation has been sent to your email address.
                  </p>
                </div>
              ) : (
                <div>
                  <h2 className="font-display text-3xl mb-2" style={{ color: "var(--fg)" }}>
                    Review & confirm
                  </h2>
                  <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
                    Please review your booking details before confirming.
                  </p>

                  <div className="space-y-4 max-w-xl">
                    {[
                      { label: "Destination", value: `${selectedDest.name}, ${selectedDest.country}` },
                      { label: "Room", value: selectedRoom.name },
                      { label: "Check-in", value: checkIn },
                      { label: "Check-out", value: checkOut },
                      { label: "Duration", value: `${nights} night${nights > 1 ? "s" : ""}` },
                      { label: "Guests", value: `${guests} guest${guests > 1 ? "s" : ""}` },
                      { label: "Guest Name", value: `${form.firstName} ${form.lastName}`.trim() || "—" },
                      { label: "Email", value: form.email || "—" },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                        <span className="text-[10px] tracking-[0.12em] uppercase" style={{ color: "var(--muted)" }}>{row.label}</span>
                        <span className="text-[11px] font-medium" style={{ color: "var(--fg)" }}>{row.value}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-4">
                      <span className="text-[10px] tracking-[0.12em] uppercase" style={{ color: "var(--gold)" }}>Total</span>
                      <span className="font-display text-xl" style={{ color: "var(--gold)" }}>${grandTotal.toLocaleString()}</span>
                    </div>
                  </div>

                  <p className="text-[11px] mt-6 max-w-md" style={{ color: "var(--dim)" }}>
                    By confirming, you agree to Aurum's booking policy. Full payment is due 30 days before arrival. Free cancellation up to 48h prior.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* navigation buttons */}
          {!submitted && (
            <div className="flex items-center gap-4 mt-12">
              {step > 1 && (
                <button
                  onClick={goBack}
                  className="text-[10px] tracking-[0.16em] uppercase px-8 py-3 transition-all duration-200"
                  style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}
                >
                  ← Back
                </button>
              )}
              {step < 4 ? (
                <button
                  onClick={goNext}
                  className="text-[10px] tracking-[0.16em] uppercase px-10 py-3 font-medium flex items-center gap-2 transition-all duration-200"
                  style={{ background: "var(--gold)", color: "var(--bg)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
                >
                  Continue <ArrowRight />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  className="text-[10px] tracking-[0.16em] uppercase px-10 py-3 font-medium flex items-center gap-2 transition-all duration-200"
                  style={{ background: "var(--gold)", color: "var(--bg)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
                >
                  Confirm Reservation <ArrowRight />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── ORDER SUMMARY SIDEBAR ── */}
        <div
          className="w-full lg:w-[300px] shrink-0"
          style={{ borderLeft: "1px solid var(--border)", background: "var(--bg2)" }}
        >
          <div className="lg:sticky lg:top-[60px] p-6">
            <div className="text-[9px] tracking-[0.25em] uppercase mb-5" style={{ color: "var(--gold)" }}>
              Your Booking
            </div>

            {/* destination thumb */}
            <div className="aspect-[16/9] overflow-hidden mb-4 rounded-sm">
              <img src={selectedDest.img} alt={selectedDest.name} className="w-full h-full object-cover" />
            </div>
            <div className="font-display text-lg mb-0.5" style={{ color: "var(--fg)" }}>{selectedDest.name}</div>
            <div className="text-[10px] mb-5" style={{ color: "var(--muted)" }}>{selectedRoom.name} · {nights} nights</div>

            <div className="h-px mb-5" style={{ background: "var(--border)" }} />

            {/* price breakdown */}
            <div className="space-y-2.5 mb-5 text-[11px]">
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>${selectedRoom.price} × {nights}n</span>
                <span style={{ color: "var(--fg)" }}>${roomTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>Service fee</span>
                <span style={{ color: "var(--fg)" }}>${serviceFee}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>Tax (12%)</span>
                <span style={{ color: "var(--fg)" }}>${tax.toLocaleString()}</span>
              </div>
            </div>

            <div className="h-px mb-5" style={{ background: "var(--border)" }} />
            <div className="flex justify-between">
              <span className="text-[11px] font-medium" style={{ color: "var(--fg)" }}>Total</span>
              <div className="text-right">
                <div className="font-display text-2xl" style={{ color: "var(--gold)" }}>${grandTotal.toLocaleString()}</div>
                <div className="text-[9px]" style={{ color: "var(--dim)" }}>all inclusive</div>
              </div>
            </div>

            <div className="mt-6 p-4" style={{ background: "rgba(196,153,90,0.06)", border: "1px solid var(--border-gold)" }}>
              <div className="text-[9px] tracking-[0.18em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                Included
              </div>
              {["Free cancellation 48h prior", "24/7 concierge support", "Airport transfer", "Welcome amenity"].map((item) => (
                <div key={item} className="flex items-center gap-2 py-1.5">
                  <span style={{ color: "var(--gold)" }}><CheckIcon /></span>
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
