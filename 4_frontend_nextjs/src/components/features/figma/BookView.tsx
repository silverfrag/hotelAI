"use client";

import { useState } from "react";
import { destinations } from "@/data/travel-inspiration";
import type { RoomPresentation } from "@/types/room-presentation.type";
import { useAuth } from "@/hooks/useAuth";
import { useReservation } from "@/hooks/useReservation";
import { formatCurrency } from "@/utils/formatCurrency";
import Link from "next/link";
import { addIsoDays } from "@/utils/businessDate";
import { ReservationRecoverySignIn } from "@/components/features/auth/ReservationRecoverySignIn";

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

type InitialBooking = { room_type_id?: string; check_in_date?: string; check_out_date?: string; guest_count?: string; total_of_special_requests?: string; destination?: string; step?: string };
export default function BookView({ rooms, businessDate, initial = {} }: { rooms: RoomPresentation[]; businessDate: string; initial?: InitialBooking }) {
  const { user, ready } = useAuth();
  const [step, setStep] = useState<Step>(initial.step === '3' ? 3 : 1);
  const [selectedDest, setSelectedDest] = useState(destinations.find((d) => d.name.toLowerCase() === initial.destination?.toLowerCase()) ?? destinations[0]);
  const [selectedRoom, setSelectedRoom] = useState(rooms.find((r) => String(r.id) === initial.room_type_id) ?? rooms[0]);
  const [checkIn, setCheckIn] = useState(initial.check_in_date || businessDate);
  const [checkOut, setCheckOut] = useState(initial.check_out_date || addIsoDays(businessDate, 5));
  const [guests, setGuests] = useState(Math.max(1, Math.min(20, Number(initial.guest_count) || 2)));
  const [requests, setRequests] = useState(Math.max(0, Math.min(5, Math.trunc(Number(initial.total_of_special_requests) || 0))));
  const [error, setError] = useState('');
  const validDates = /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(checkOut)
    && Number.isFinite(Date.parse(checkIn)) && Number.isFinite(Date.parse(checkOut))
    && new Date(checkIn).toISOString().slice(0,10) === checkIn && new Date(checkOut).toISOString().slice(0,10) === checkOut
    && checkIn >= businessDate && checkOut > checkIn;
  const nights = validDates ? Math.round((Date.parse(checkOut) - Date.parse(checkIn))/86400000) : 0;
  const input = selectedRoom && validDates && guests >= 1 && guests <= selectedRoom.guests && Number.isInteger(guests) && requests >= 0 && requests <= 5 && Number.isInteger(requests)
    ? { room_type_id: selectedRoom.id, check_in_date: checkIn, check_out_date: checkOut, guest_count: guests, total_of_special_requests: requests } : null;
  const reservation = useReservation(input);
  const { quote, result, loading, quoteError, expired, submitting, retryOnly, recoveryAccount, recoveryNeedsSignIn } = reservation;
  const submitted = !!result;
  const roomTotal = (selectedRoom?.price ?? 0) * nights;
  const nightlyPrice = result?.nightly_price ?? quote?.nightly_price ?? selectedRoom?.price ?? 0;
  const grandTotal = result?.total_price ?? quote?.total_price ?? roomTotal;
  const returnUrl = `/book?${new URLSearchParams({ room_type_id: String(selectedRoom?.id ?? ''), check_in_date: checkIn, check_out_date: checkOut, guest_count: String(guests), total_of_special_requests: String(requests), destination: selectedDest.name, step: '3' })}`;
  const goNext = () => {
    if (submitting || result || retryOnly) return;
    if (!validDates) { setError('Choose valid arrival and departure dates.'); return; }
    if (step >= 2 && !input) { setError('Choose a room with enough space for your guests.'); return; }
    if (step === 3 && !user) { setError('Sign in to connect this reservation to your account.'); return; }
    setError(''); setStep((value) => Math.min(4, value + 1) as Step);
  };
  const goBack = () => { if (submitting || result || retryOnly) return; setError(''); setStep((value) => Math.max(1, value - 1) as Step); };
  const handleSubmit = () => { void reservation.confirm(); };
  if (!selectedRoom) return <section className="px-5 md:px-16 pt-32 pb-24"><h1 className="font-display text-4xl mb-4">Begin Your Journey</h1><p>No rooms are available to book. Please try again later.</p><Link href="/rooms" className="inline-block mt-6 underline">Explore rooms</Link></section>;

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
                Explore travel inspiration and set your dates. Destinations are editorial, not bookable hotel locations.
              </p>

              {/* dates */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8 p-6" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                <div>
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Check In
                  </label>
                  <input
                    type="date"
                    aria-label="Check in" min={businessDate} required value={checkIn}
                    onChange={(e) => { if (e.target.value !== checkIn && !submitting && !retryOnly) { reservation.changeSelection(); setCheckIn(e.target.value); } }}
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
                    aria-label="Check out" min={/^\d{4}-\d{2}-\d{2}$/.test(checkIn) && Number.isFinite(Date.parse(checkIn)) ? addIsoDays(checkIn, 1) : businessDate} required value={checkOut}
                    onChange={(e) => { if (e.target.value !== checkOut && !submitting && !retryOnly) { reservation.changeSelection(); setCheckOut(e.target.value); } }}
                    className="w-full bg-transparent text-sm outline-none pb-2 [color-scheme:dark]"
                    style={{ borderBottom: "1px solid var(--border-gold)", color: "var(--fg)" }}
                  />
                </div>
                <div>
                  <label className="block text-[9px] tracking-[0.2em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                    Guests
                  </label>
                  <div className="flex items-center gap-3 pb-2" style={{ borderBottom: "1px solid var(--border-gold)" }}>
                    <button aria-label="Fewer guests" disabled={guests <= 1 || submitting || retryOnly} onClick={() => { reservation.changeSelection(); setGuests((g) => Math.max(1, g - 1)); }} className="text-lg leading-none" style={{ color: "var(--gold)" }}>−</button>
                    <span className="text-sm tabular-nums" style={{ color: "var(--fg)" }}>{guests}</span>
                    <button aria-label="More guests" disabled={guests >= 20 || submitting || retryOnly} onClick={() => { reservation.changeSelection(); setGuests((g) => Math.min(20, g + 1)); }} className="text-lg leading-none" style={{ color: "var(--gold)" }}>+</button>
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
                      role="button" tabIndex={0} aria-pressed={sel} aria-label={`Choose ${dest.name} inspiration`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedDest(dest); } }} onClick={() => setSelectedDest(dest)}
                    >
                      <div className="w-20 h-16 overflow-hidden shrink-0 rounded-sm">
                        <img src={dest.img} alt={dest.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] tracking-widest uppercase mb-0.5" style={{ color: "var(--gold)" }}>
                          {dest.region}
                        </div>
                        <div className="font-display text-base" style={{ color: "var(--fg)" }}>{dest.name}</div>
                        <div className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>Travel inspiration</div>
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
                      role="button" tabIndex={available ? 0 : -1} aria-disabled={!available} aria-pressed={sel} aria-label={`Choose ${room.name}`} onKeyDown={(e) => { if (available && !sel && !submitting && !retryOnly && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); reservation.changeSelection(); setSelectedRoom(room); } }} onClick={() => { if (available && !sel && !submitting && !retryOnly) { reservation.changeSelection(); setSelectedRoom(room); } }}
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
                            {room.type} · Illustrative photograph
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {room.features.slice(0, 3).map((f) => (
                              <span key={f} className="text-[8px] uppercase tracking-wider px-2 py-0.5" style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}>{f}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-display text-xl" style={{ color: "var(--gold)" }}>{formatCurrency(room.price)}</div>
                          <div className="text-[9px]" style={{ color: "var(--dim)" }}>/night</div>
                          <div className="font-display text-sm mt-1" style={{ color: "var(--muted)" }}>
                            {formatCurrency(room.price * nights)} total
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
          {step === 3 && <div>
            <h2 className="font-display text-3xl mb-2">Guest details</h2>
            <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>Your reservation uses your hotel account details.</p>
            {!ready ? <p role="status">Checking your account…</p> : !user ? <div className="p-6 max-w-xl" style={{ border: '1px solid var(--border-gold)', background: 'var(--bg2)' }}>
              <p className="text-sm mb-6">Sign in or create an account to continue. Your room and dates will be kept.</p>
              <Link href={`/login?next=${encodeURIComponent(returnUrl)}`} className="inline-block px-6 py-3 text-xs mr-4" style={{ background:'var(--gold)',color:'var(--bg)' }}>Sign in</Link>
              <Link href={`/register?next=${encodeURIComponent(returnUrl)}`} className="text-xs underline">Create account</Link>
            </div> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
              {[{label:'Guest name', value:user.full_name}, {label:'Email',value:user.email}, {label:'Phone',value:user.phone ?? 'Not provided'}, {label:'Country',value:user.nationality ?? 'Not provided'}].map((field) => <div key={field.label}><p className="text-[9px] tracking-[.2em] uppercase mb-2" style={{color:'var(--gold)'}}>{field.label}</p><p className="text-sm pb-2 break-words" style={{borderBottom:'1px solid var(--border-gold)'}}>{field.value}</p></div>)}
              <Link href="/profile" className="text-xs underline">Update account details</Link>
            </div>}
            <div className="mt-8 max-w-sm"><label htmlFor="booking-request-count" className="block text-[9px] tracking-[.2em] uppercase mb-2" style={{color:'var(--gold)'}}>Special requests</label><input id="booking-request-count" type="number" min={0} max={5} step={1} value={requests} onChange={(event) => { if (requests !== Number(event.target.value) && !submitting && !retryOnly) { reservation.changeSelection(); setRequests(Number(event.target.value)); } }} className="w-24 p-3 bg-transparent" style={{border:'1px solid var(--border-gold)'}} /><p className="mt-2 text-xs" style={{color:'var(--muted)'}}>Number of requests (0–5). Arrange the details with the hotel; additional services are not included in this reservation.</p></div>
          </div>}

          {/* STEP 4: Confirmation */}
          {step === 4 && (
            <div>
              {result ? (
                <div className="py-10 max-w-lg" role="status">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-8" style={{border:'1px solid var(--gold)',color:'var(--gold)'}}><CheckIcon /></div>
                  <h2 className="font-display text-4xl mb-4">{result.booking.status === 'Confirmed' ? 'Reservation confirmed' : result.booking.status === 'Pending' ? 'Reservation awaiting deposit' : `Reservation: ${result.booking.status}`}</h2>
                  <p className="text-sm mb-6" style={{color:'var(--muted)'}}>Your reservation is saved in My bookings. Payment is arranged with the hotel.</p>
                  {result.booking.status === 'Pending' && <p className="text-sm mb-6" style={{color:'var(--gold)'}}>Required deposit: {formatCurrency(result.booking.deposit_required)}. Hold expires: {result.booking.pending_expires_at ? new Date(result.booking.pending_expires_at).toLocaleString('en-GB', {timeZone:'Asia/Bangkok'}) + ' (Bangkok)' : 'Check My bookings for your deadline'}.</p>}
                  <div className="p-5 mb-6" style={{border:'1px solid var(--border-gold)',background:'var(--bg2)'}}><p className="text-[9px] tracking-[.2em] uppercase mb-3">Booking reference</p><p className="font-display text-xl break-all">{result.booking.booking_id}</p><p className="text-xs mt-3">Room {result.room_number} · {selectedRoom.name} · {nights} nights</p><p className="mt-3 text-sm">Total {formatCurrency(result.total_price ?? result.applied_price)} · Payment: {result.payment_status}</p></div>
                  <Link href="/bookings" className="inline-block px-6 py-3 text-xs" style={{background:'var(--gold)',color:'var(--bg)'}}>View My bookings</Link>
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
                      { label: "Travel inspiration", value: `${selectedDest.name}, ${selectedDest.country}` },
                      { label: "Room", value: selectedRoom.name },
                      { label: "Check-in", value: checkIn },
                      { label: "Check-out", value: checkOut },
                      { label: "Duration", value: `${nights} night${nights > 1 ? "s" : ""}` },
                      { label: "Guests", value: `${guests} guest${guests > 1 ? "s" : ""}` },
                      { label: "Guest Name", value: user?.full_name ?? "—" },
                      { label: "Email", value: user?.email ?? "—" },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                        <span className="text-[10px] tracking-[0.12em] uppercase" style={{ color: "var(--muted)" }}>{row.label}</span>
                        <span className="text-[11px] font-medium" style={{ color: "var(--fg)" }}>{row.value}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-4">
                      <span className="text-[10px] tracking-[0.12em] uppercase" style={{ color: "var(--gold)" }}>Total</span>
                      <span className="font-display text-xl" style={{ color: "var(--gold)" }}>{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>

                  <p className="text-[11px] mt-6 max-w-md" style={{ color: "var(--dim)" }}>
                    The hotel will save your reservation when you confirm. Deposit requirements and any hold deadline are shown with the saved reservation. No card is charged here.
                  </p>
                </div>
              )}
            </div>
          )}

          {(error || reservation.error) && <p role="alert" className="mt-6 text-sm text-red-400">{error || reservation.error}</p>}
          {step === 4 && recoveryNeedsSignIn && recoveryAccount && <ReservationRecoverySignIn account={recoveryAccount} />}
          {retryOnly && !result && <p role="status" className="mt-4 text-xs">Keep this page open to recover the existing request. Check <Link href="/bookings" target="_blank" rel="noopener noreferrer" className="underline">My bookings in another tab</Link> before leaving or reloading.</p>}
          {/* navigation buttons */}
          {!submitted && (
            <div className="flex items-center gap-4 mt-12">
              {step > 1 && (
                <button
                  onClick={goBack} disabled={submitting || retryOnly}
                  className="text-[10px] tracking-[0.16em] uppercase px-8 py-3 transition-all duration-200"
                  style={{ border: "1px solid var(--border-gold)", color: "var(--muted)" }}
                >
                  ← Back
                </button>
              )}
              {step < 4 ? (
                <button
                  onClick={goNext} disabled={submitting || retryOnly}
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
                  disabled={!user || recoveryNeedsSignIn || !quote || loading || (!retryOnly && expired) || submitting || (!retryOnly && quote.rooms_available < 1)}
                  className="text-[10px] tracking-[0.16em] uppercase px-10 py-3 font-medium flex items-center gap-2 transition-all duration-200"
                  style={{ background: "var(--gold)", color: "var(--bg)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
                >
                  {submitting ? "Saving reservation…" : retryOnly ? "Recover reservation" : "Confirm Reservation"} <ArrowRight />
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
              <img src={selectedRoom.img} alt={`${selectedRoom.name} illustrative photo`} className="w-full h-full object-cover" />
            </div>
            <div className="font-display text-lg mb-0.5" style={{ color: "var(--fg)" }}>{selectedRoom.name}</div>
            <div className="text-[10px] mb-5" style={{ color: "var(--muted)" }}>{selectedRoom.name} · {nights} nights</div>

            <div className="h-px mb-5" style={{ background: "var(--border)" }} />

            {/* price breakdown */}
            <div className="space-y-2.5 mb-5 text-[11px]">
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>{formatCurrency(nightlyPrice)} × {nights}n</span>
                <span style={{ color: "var(--fg)" }}>{formatCurrency(grandTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>Pricing</span>
                <span style={{ color: "var(--fg)" }}>{quote ? quote.pricing_source === "ai" ? "AI quote" : "Base rate" : "Base estimate"}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>Availability</span>
                <span style={{ color: "var(--fg)" }}>{quote ? `${quote.rooms_available} rooms for your dates` : "Check your dates"}</span>
              </div>
            </div>

            <div className="h-px mb-5" style={{ background: "var(--border)" }} />
            <div className="flex justify-between">
              <span className="text-[11px] font-medium" style={{ color: "var(--fg)" }}>Total</span>
              <div className="text-right">
                <div className="font-display text-2xl" style={{ color: "var(--gold)" }}>{formatCurrency(grandTotal)}</div>
                <div className="text-[9px]" style={{ color: "var(--dim)" }}>{quote ? "hotel quote · VND" : "base estimate · VND"}</div>
              </div>
            </div>

            <div className="mt-5 text-xs leading-relaxed" aria-live="polite" style={{color:'var(--muted)'}}>
              {loading ? <p role="status">Checking availability and price…</p> : quoteError ? <p role="alert">We couldn’t get a price quote. The pricing service may be temporarily unavailable.</p> : expired ? <p role="alert">This quote has expired.</p> : quote ? <><p>Final price: {formatCurrency(quote.total_price)}</p><p>Valid until {new Date(quote.price_guaranteed_until).toLocaleTimeString('en-GB',{timeZone:'Asia/Bangkok'})} (Bangkok). Rooms are subject to availability until reserved.</p></> : <p>Select valid dates and a room that fits your party.</p>}
              {!submitted && <button type="button" disabled={loading || submitting || retryOnly || !input} onClick={reservation.refreshQuote} className="mt-3 underline" style={{color:'var(--gold)'}}>Refresh price</button>}
            </div>
            <div className="mt-6 p-4" style={{ background: "rgba(196,153,90,0.06)", border: "1px solid var(--border-gold)" }}>
              <div className="text-[9px] tracking-[0.18em] uppercase mb-2" style={{ color: "var(--gold)" }}>
                Your reservation
              </div>
              {["Account-linked reservation", "Date-specific availability", "Hotel price quote", "Booking history access"].map((item) => (
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
