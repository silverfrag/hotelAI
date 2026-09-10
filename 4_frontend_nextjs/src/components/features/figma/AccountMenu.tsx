'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/contexts/LanguageContext';

export function AccountMenu() {
  const { user, ready, logout, loggingOut, logoutError } = useAuth();
  const { language, setLanguage } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  async function signOut() {
    try {
      await logout();
      router.push('/');
      router.refresh();
      menu.current?.removeAttribute('open');
    } catch {
      // Keep the menu open so the provider's error and retry action remain visible.
    }
  }
  useEffect(() => { menu.current?.removeAttribute('open'); }, [pathname]);
  return (
    <details ref={menu} className="account-menu relative" onKeyDown={(event) => {
      if (event.key === 'Escape') { menu.current?.removeAttribute('open'); menu.current?.querySelector('summary')?.focus(); }
    }}>
      <summary aria-label="Account menu" className="p-1" style={{ color: 'var(--gold)' }}><UserRound size={17} /></summary>
      <div className="absolute right-0 top-9 z-[60] w-52 py-2 text-[11px] shadow-xl" style={{ background: 'var(--bg2)', border: '1px solid var(--border-gold)', color: 'var(--fg)' }}>
        {!ready ? <p className="px-3 py-2">Loading account…</p> : user ? <>
          <p className="px-3 py-2 truncate" title={user.full_name}>{user.full_name}</p>
          <Link href="/profile">My profile</Link>
          <Link href="/bookings">My bookings</Link>
          {user.role === 'admin' && <Link href="/admin">Hotel management</Link>}
          <button disabled={loggingOut} onClick={() => void signOut()}>{loggingOut ? 'Signing out…' : 'Sign out'}</button>
          {logoutError && <p role="alert" className="px-3 py-2">Sign out failed. Please try again.</p>}
        </> : <><Link href="/login">Sign in</Link><Link href="/register">Create account</Link></>}
        <Link href="/checkout">Price quote</Link>
        <button onClick={() => setLanguage(language === 'en' ? 'vi' : 'en')}>Account language: {language.toUpperCase()}</button>
      </div>
    </details>
  );
}
