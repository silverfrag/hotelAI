'use client';

import { useEffect, useState } from 'react';
import {
  getPriceQuote,
  PriceQuoteInput,
} from '@/services/booking.service';
import { PriceQuote } from '@/types/room.type';

export function useDynamicPrice(input: PriceQuoteInput | null, refreshKey = 0) {
  const normalizedCoupon = input?.coupon_code?.trim().toUpperCase() || '';
  const requestKey = JSON.stringify([input?.room_type_id, input?.check_in_date,
    input?.check_out_date, input?.total_of_special_requests, input?.guest_count, normalizedCoupon, refreshKey]);
  const [resolved, setResolved] = useState<{ quote: PriceQuote; key: string } | null>(null);
  const quote = resolved?.key === requestKey ? resolved.quote : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setResolved(null);
    setError('');
    if (!input) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await getPriceQuote(input, controller.signal);
        if (!controller.signal.aborted) setResolved({ quote: result, key: requestKey });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'Không thể tạo báo giá.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    input?.room_type_id,
    input?.check_in_date,
    input?.check_out_date,
    input?.total_of_special_requests,
    input?.guest_count,
    normalizedCoupon,
    refreshKey,
  ]);

  return { quote, loading, error };
}
