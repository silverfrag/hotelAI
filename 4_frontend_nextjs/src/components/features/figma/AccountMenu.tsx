'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/contexts/LanguageContext';

export function AccountMenu() {
  const { user, ready, logout, loggingOut, logoutError } = useAuth();
  const { language, setLanguage, supportedLanguages, currentLanguageInfo, t } = useTranslation();
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

  function cycleLanguage() {
    const currentIndex = supportedLanguages.findIndex((l) => l.code === language);
    const nextIndex = (currentIndex + 1) % supportedLanguages.length;
    setLanguage(supportedLanguages[nextIndex].code);
  }

  useEffect(() => {
    menu.current?.removeAttribute('open');
  }, [pathname]);

  return (
    <details
      ref={menu}
      className="account-menu relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          menu.current?.removeAttribute('open');
          menu.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label={t('account_menu')} className="p-1 cursor-pointer" style={{ color: 'var(--gold)' }}>
        <UserRound size={17} />
      </summary>
      <div
        className="absolute right-0 top-9 z-[60] w-52 py-2 text-[11px] shadow-2xl backdrop-blur-xl"
        style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border-gold)',
          color: 'var(--fg)',
        }}
      >
        {!ready ? (
          <p className="px-3 py-2">{t('account_loading')}</p>
        ) : user ? (
          <>
            <p className="px-3 py-2 truncate font-semibold" style={{ color: 'var(--gold)' }} title={user.full_name}>
              {user.full_name}
            </p>
            <Link href="/profile">{t('account_my_profile')}</Link>
            <Link href="/bookings">{t('account_my_bookings')}</Link>
            {user.role === 'admin' && <Link href="/admin">{t('account_management')}</Link>}
            <button disabled={loggingOut} onClick={() => void signOut()} type="button">
              {loggingOut ? t('account_signing_out') : t('account_sign_out')}
            </button>
            {logoutError && <p role="alert" className="px-3 py-2 text-rose-400">Sign out failed. Please try again.</p>}
          </>
        ) : (
          <>
            <Link href="/login">{t('account_sign_in')}</Link>
            <Link href="/register">{t('account_create')}</Link>
          </>
        )}
        <Link href="/checkout">{t('account_price_quote')}</Link>
        <button
          onClick={cycleLanguage}
          type="button"
          className="flex items-center justify-between border-t mt-1 pt-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <span>{t('lang_switch')}:</span>
          <span className="font-semibold" style={{ color: 'var(--gold)' }}>
            {currentLanguageInfo.flag} {currentLanguageInfo.short}
          </span>
        </button>
      </div>
    </details>
  );
}
