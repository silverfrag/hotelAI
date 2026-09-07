'use client';

import Link from 'next/link';

export default function PublicError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-[70vh] px-6 md:px-16 pt-32 pb-20" role="alert">
      <p className="text-[10px] tracking-[.2em] uppercase mb-4" style={{ color: 'var(--gold)' }}>Please try again</p>
      <h1 className="font-display text-4xl mb-5">We couldn’t load this page.</h1>
      <p className="max-w-md text-sm mb-8" style={{ color: 'var(--muted)' }}>The hotel service may be temporarily unavailable. Your existing reservations are saved.</p>
      <button onClick={reset} className="px-6 py-3 mr-6 text-xs" style={{ background: 'var(--gold)', color: 'var(--bg)' }}>Try again</button>
      <Link href="/" className="text-xs underline">Return home</Link>
    </main>
  );
}
