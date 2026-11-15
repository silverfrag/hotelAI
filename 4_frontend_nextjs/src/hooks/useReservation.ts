'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDynamicPrice } from '@/hooks/useDynamicPrice';
import { createBooking, BookingServiceError, type PriceQuoteInput } from '@/services/booking.service';
import { createQuoteSearchId, getOrCreateQuoteSessionId, recordQuoteEventOnce } from '@/services/quote-telemetry';
import type { BookingResult, QuoteTrackingContext } from '@/types/room.type';

/** Reservation orchestration for the migrated view, reusing the core services. */
export function useReservation(input: PriceQuoteInput | null, initialSearchId?: string) {
  const { accessToken, user, refreshSession } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const { quote: candidate, loading, error: quoteError } = useDynamicPrice(input, refreshKey);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [retryOnly, setRetryOnly] = useState(false);
  const [recoveryAccount, setRecoveryAccount] = useState<{ id: string; email: string } | null>(null);
  const [now, setNow] = useState(0);
  const busy = useRef(false);
  const tracking = useRef<QuoteTrackingContext | null>(null);
  const [visibleQuoteId, setVisibleQuoteId] = useState<string | null>(null);
  const [docVisible, setDocVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  const booked = useRef(new Set<string>());
  const normalizedCoupon = input?.coupon_code?.trim().toUpperCase() || '';
  const quote = candidate && input
    && candidate.room_type.type_id === input.room_type_id
    && candidate.check_in_date === input.check_in_date
    && candidate.check_out_date === input.check_out_date
    && candidate.guest_count === input.guest_count
    && (!normalizedCoupon
      ? !candidate.coupon_code
      : candidate.coupon_code?.trim().toUpperCase() === normalizedCoupon)
    ? candidate
    : null;
  const expired = !!quote && now >= Date.parse(quote.price_guaranteed_until);
  const recoveryNeedsSignIn = retryOnly && !!recoveryAccount && user?.id !== recoveryAccount.id;

  function context() {
    return tracking.current ??= { session_id: getOrCreateQuoteSessionId(), search_id: initialSearchId ?? createQuoteSearchId() };
  }
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    const syncVisibility = () => setDocVisible(document.visibilityState === 'visible');
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, []);
  useEffect(() => {
    if (!quote || loading || result || visibleQuoteId !== quote.quote_id || !docVisible) return;
    void recordQuoteEventOnce(quote.quote_id, 'quote.exposed.v1', context()).catch(() => undefined);
  }, [quote, loading, result, visibleQuoteId, docVisible]);

  function changeSelection() {
    if (busy.current || result || retryOnly) return;
    setError('');
    // A changed selection is not an explicit rejection. Supersession is
    // recorded only when both quotes have a verified exposure.
    setVisibleQuoteId(null);
  }

  async function confirm() {
    if (busy.current || result) return;
    if (!accessToken || !user) { setError('Please sign in before reserving your stay.'); return; }
    if (retryOnly && user.id !== recoveryAccount?.id) {
      setError(`Sign in as ${recoveryAccount?.email ?? 'the original guest'} to recover this reservation. The current account cannot recover it.`);
      return;
    }
    if (!input || !quote || loading) { setError('Wait for a valid price quote.'); return; }
    if (!retryOnly && Date.parse(quote.price_guaranteed_until) <= Date.now()) { setError('This quote has expired. Refresh the price before reserving.'); return; }
    if (!retryOnly && quote.rooms_available < 1) { setError('No rooms are available for these dates.'); return; }
    busy.current = true;
    booked.current.add(quote.quote_id);
    setSubmitting(true); setError('');
    let creationAttempted = false;
    try {
      // Recovery remains in this mounted form and must use the original account:
      // backend idempotency is scoped by customer, so switching users is unsafe.
      if (!retryOnly) setRecoveryAccount({ id: user.id, email: user.email });
      creationAttempted = true;
      const created = await createBooking({ ...input, quote_id: quote.quote_id }, accessToken, `booking:${quote.quote_id}`);
      if (created.total_price !== quote.total_price) {
        throw new BookingServiceError('The saved price does not match the accepted quote.', 201);
      }
      setResult(created);
    } catch (caught) {
      booked.current.delete(quote.quote_id);
      // An interrupted response may hide a committed booking. Retain this quote
      // and idempotency key until a retry recovers its authoritative result.
      setRetryOnly(retryOnly || (creationAttempted && (!(caught instanceof BookingServiceError)
        || caught.status >= 500 || (caught.status >= 200 && caught.status < 300))));
      if (caught instanceof BookingServiceError && caught.status === 401) await refreshSession().catch(() => null);
      setError(!creationAttempted ? 'We couldn’t prepare your reservation. Please retry or refresh the price.'
        : caught instanceof BookingServiceError && caught.status === 409
        ? 'This quote or reservation has changed. Review My bookings before refreshing and trying again.'
        : caught instanceof BookingServiceError && caught.status === 401 ? 'Your session expired. Please sign in again.'
        : 'We couldn’t complete your reservation. You can retry safely or check My bookings.');
    } finally { busy.current = false; setSubmitting(false); }
  }
  return { quote, loading, quoteError, error, result, expired, submitting, retryOnly, recoveryAccount, recoveryNeedsSignIn, confirm, changeSelection, markQuoteVisible: setVisibleQuoteId, refreshQuote: () => { if (busy.current || result || retryOnly) return; setVisibleQuoteId(null); setError(''); setRefreshKey((key) => key + 1); } };
}
