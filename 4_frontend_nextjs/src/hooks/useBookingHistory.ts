'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookingServiceError,
  cancelBooking as cancelBookingRequest,
  getBookings,
} from '@/services/booking.service';
import { BookingSummary } from '@/types/booking.type';

interface UseBookingHistoryOptions {
  accessToken: string | null;
  enabled: boolean;
  onUnauthorized: () => void;
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useBookingHistory({
  accessToken,
  enabled,
  onUnauthorized,
}: UseBookingHistoryOptions) {
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const handleError = useCallback((caught: unknown, fallback: string) => {
    if (caught instanceof BookingServiceError && caught.status === 401) {
      onUnauthorized();
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    }
    return messageFrom(caught, fallback);
  }, [onUnauthorized]);

  const load = useCallback(async (showLoading = true) => {
    if (!enabled || !accessToken) return;

    const sequence = ++requestSequence.current;
    if (showLoading) setLoading(true);
    setError('');

    try {
      const nextBookings = await getBookings(accessToken);
      if (requestSequence.current === sequence) setBookings(nextBookings);
    } catch (caught) {
      if (requestSequence.current === sequence) {
        setError(handleError(caught, 'Không thể tải lịch sử đặt phòng.'));
      }
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [accessToken, enabled, handleError]);

  useEffect(() => {
    if (!enabled || !accessToken) return;
    const refresh = () => { if (document.visibilityState === 'visible') void load(false); };
    window.addEventListener('focus', refresh);
    const timer = bookings.some((booking) => booking.status === 'Pending')
      ? window.setInterval(refresh, 15000)
      : undefined;
    return () => {
      window.removeEventListener('focus', refresh);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [accessToken, enabled, load, bookings.some((booking) => booking.status === 'Pending')]);

  useEffect(() => {
    if (!enabled || !accessToken) {
      requestSequence.current += 1;
      setBookings([]);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');

    getBookings(accessToken, controller.signal)
      .then((nextBookings) => {
        if (requestSequence.current === sequence) setBookings(nextBookings);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        if (requestSequence.current === sequence) {
          setError(handleError(caught, 'Không thể tải lịch sử đặt phòng.'));
        }
      })
      .finally(() => {
        if (requestSequence.current === sequence) setLoading(false);
      });

    return () => {
      requestSequence.current += 1;
      controller.abort();
    };
  }, [accessToken, enabled, handleError]);

  const cancel = useCallback(async (bookingId: string) => {
    if (!accessToken || cancellingId) return false;

    setCancellingId(bookingId);
    setActionMessage('');
    setError('');

    try {
      const canceledBooking = await cancelBookingRequest(bookingId, accessToken);
      setBookings((current) => current.map((booking) => (
        booking.booking_id === bookingId
          ? canceledBooking
          : booking
      )));
      setActionMessage('Đã hủy đặt phòng thành công.');
      await load(false);
      return true;
    } catch (caught) {
      if (caught instanceof BookingServiceError && caught.status === 409) await load(false);
      setError(handleError(caught, 'Không thể hủy đặt phòng.'));
      return false;
    } finally {
      setCancellingId(null);
    }
  }, [accessToken, cancellingId, handleError, load]);

  return {
    bookings,
    loading,
    error,
    actionMessage,
    cancellingId,
    reload: load,
    cancel,
  };
}
