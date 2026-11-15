'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';

export function CatalogUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { language } = useTranslation();
  const vi = language === 'vi';
  return (
    <div role="alert" className="p-6 my-6 text-sm" style={{ background: 'var(--bg2)', border: '1px solid var(--border-gold)' }}>
      <p className="font-medium mb-2">{vi ? 'Chưa tải được danh sách phòng' : 'Room catalog is temporarily unavailable'}</p>
      <p style={{ color: 'var(--muted)' }}>{vi
        ? 'Vui lòng thử lại để xem giá và tình trạng phòng hiện tại.'
        : 'Please retry to view current rooms and prices.'}</p>
      <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}
        className="mt-4 px-5 py-3 text-xs" style={{ background: 'var(--gold)', color: 'var(--bg)' }}>
        {pending ? (vi ? 'Đang tải…' : 'Loading…') : (vi ? 'Thử lại' : 'Try again')}
      </button>
    </div>
  );
}
