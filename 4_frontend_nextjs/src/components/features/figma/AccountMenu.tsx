'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/contexts/LanguageContext';
import { getOwnNotifications } from '@/services/booking.service';

export function AccountMenu() {
  const { user, ready, logout, loggingOut, logoutError } = useAuth();
  const { language, setLanguage, supportedLanguages, currentLanguageInfo, t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);

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

  useEffect(() => {
    if (!ready || !user) {
      setUnreadCount(0);
      return;
    }
    const controller = new AbortController();
    void getOwnNotifications({ limit: 1, offset: 0 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setUnreadCount(page.unread);
      })
      .catch(() => undefined);

    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ unread?: number }>).detail;
      if (typeof detail?.unread === 'number') {
        setUnreadCount(detail.unread);
      }
    };
    window.addEventListener('hotelai:notifications-updated', onUpdated);
    return () => {
      controller.abort();
      window.removeEventListener('hotelai:notifications-updated', onUpdated);
    };
  }, [ready, user?.id, pathname]);

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
      <summary aria-label={t('account_menu')} className="p-1 cursor-pointer relative" style={{ color: 'var(--gold)' }}>
        <UserRound size={17} />
        {unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} thông báo chưa đọc`}
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
            style={{ background: 'var(--gold)', color: 'var(--bg)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
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
            <Link href="/bookings#notifications">
              <span className="inline-flex w-full items-center justify-between gap-2">
                <span>Thông báo đặt phòng</span>
                {unreadCount > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                    style={{ background: 'var(--gold)', color: 'var(--bg)' }}
                  >
                    {unreadCount}
                  </span>
                )}
              </span>
            </Link>
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
