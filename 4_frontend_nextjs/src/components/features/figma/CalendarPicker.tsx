'use client';

import { useState, useEffect } from 'react';
import { getCalendarPricing } from '@/services/booking.service';

interface CalendarPickerProps {
  roomTypeId?: number;
  initialCheckIn: string;
  initialCheckOut: string;
  businessDate: string;
  onDatesChange: (checkIn: string, checkOut: string) => void;
}

export function CalendarPicker({
  roomTypeId,
  initialCheckIn,
  initialCheckOut,
  businessDate,
  onDatesChange,
}: CalendarPickerProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date(initialCheckIn);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  
  const [pricingMap, setPricingMap] = useState<Record<string, { price: number; available: number }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!roomTypeId) return;
    const controller = new AbortController();
    
    async function fetchPricing() {
      setLoading(true);
      try {
        const start = currentMonth.toISOString().slice(0, 10);
        // fetch 60 days
        const end = new Date(currentMonth.getTime() + 60 * 86400000).toISOString().slice(0, 10);
        const data = await getCalendarPricing(roomTypeId!, start, end, controller.signal);
        if (controller.signal.aborted) return;
        
        const map: Record<string, { price: number; available: number }> = {};
        for (const item of data) {
          map[item.date] = { price: item.nightly_price, available: item.available };
        }
        setPricingMap(map);
      } catch (err) {
        // ignore aborts
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchPricing();
    
    return () => controller.abort();
  }, [roomTypeId, currentMonth.getTime()]);

  // simple layout: just rely on native date inputs but display the fetched price next to it, 
  // or a mini table. Given time constraints, I will build a lightweight grid for the current month.
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i, 12).toISOString().slice(0, 10);
    days.push(dateStr);
  }

  const formatPrice = (p: number) => {
    if (p >= 1000000) return `${(p/1000000).toFixed(1)}M`;
    if (p >= 1000) return `${Math.round(p/1000)}k`;
    return p;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center text-sm" style={{ color: 'var(--gold)' }}>
        <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>&larr; Prev</button>
        <span>{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>Next &rarr;</button>
      </div>

      {loading && <div className="text-xs text-center" style={{ color: 'var(--muted)' }}>Loading prices...</div>}

      <div className="grid grid-cols-7 gap-1 text-center text-[10px]" style={{ color: 'var(--muted)' }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const p = pricingMap[d];
          const isSelected = d >= initialCheckIn && d < initialCheckOut;
          const isCheckOutOnly = d === initialCheckOut;
          const isPast = d < businessDate;
          const available = p?.available > 0;
          
          return (
            <div 
              key={d} 
              className={`p-1 flex flex-col items-center justify-center border transition-all duration-200 ${isPast ? 'opacity-30' : 'cursor-pointer'} ${isSelected ? 'bg-amber-900/40 border-amber-500' : isCheckOutOnly ? 'border-amber-500/50' : 'border-transparent'}`}
              onClick={() => {
                if (isPast) return;
                // Simple toggle logic
                if (d < initialCheckIn) onDatesChange(d, initialCheckIn);
                else onDatesChange(initialCheckIn, d === initialCheckIn ? new Date(new Date(d).getTime() + 86400000).toISOString().slice(0, 10) : d);
              }}
            >
              <div className="text-sm font-medium text-white">{d.slice(-2)}</div>
              {p && <div className="text-[9px] mt-0.5" style={{ color: available ? 'var(--gold)' : '#ef4444' }}>{available ? formatPrice(p.price) : 'Full'}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
