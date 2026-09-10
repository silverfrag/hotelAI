'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Globe, Moon, Sun, User as UserIcon, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/contexts/ThemeContext';
import { useTranslation } from '@/contexts/LanguageContext';

export function Navbar() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const { user, ready, logout, loggingOut, logoutError } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useTranslation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function signOut() {
    try {
      await logout();
      router.push('/');
      router.refresh();
    } catch {
      // Keep the current account visible until server sign-out is confirmed.
    }
  }

  function switchLanguage() {
    setLanguage(language === 'vi' ? 'en' : 'vi');
  }

  return (
    <header className={`fixed top-0 z-50 w-full transition-all duration-500 border-b ${scrolled ? 'border-[var(--border-gold)] bg-[var(--navbar-bg)] backdrop-blur-xl' : 'border-transparent bg-transparent'}`}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-16 py-4 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <Link href="/" className="group flex items-center gap-3.5 focus:outline-none" aria-label="Hotel AI - Trang chủ">
          <div className="w-7 h-7 rounded-full border border-[var(--gold-primary)] flex items-center justify-center transition-transform group-hover:scale-105">
            <div className="w-2 h-2 rounded-full bg-[var(--gold-primary)]" />
          </div>
          <div className="flex flex-col">
            <span className="font-serif text-base tracking-[0.22em] text-[var(--text-primary)] uppercase">
              Hotel AI
            </span>
            <span className="text-[8px] uppercase tracking-[0.2em] text-[var(--text-muted)] font-semibold -mt-0.5">
              Sanctuary & Dynamic
            </span>
          </div>
        </Link>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-[10px] uppercase tracking-[0.14em] font-medium" aria-label="Điều hướng chính">
          <Link
            href="/"
            className="text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition-colors py-1 relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[2px] after:bg-[var(--gold-primary)] hover:after:w-full after:transition-all"
          >
            {t('nav_home')}
          </Link>
          <Link
            href="/rooms"
            className="text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition-colors py-1 relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[2px] after:bg-[var(--gold-primary)] hover:after:w-full after:transition-all"
          >
            {t('nav_rooms')}
          </Link>
          <Link
            href="/checkout"
            className="text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition-colors py-1 relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[2px] after:bg-[var(--gold-primary)] hover:after:w-full after:transition-all"
          >
            {t('nav_quote')}
          </Link>
          {ready && user && (
            <>
              <Link
                href="/bookings"
                className="text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition-colors py-1"
              >
                {t('nav_my_bookings')}
              </Link>
              <Link
                href="/profile"
                className="text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition-colors py-1"
              >
                {t('nav_profile')}
              </Link>
              {user.role === 'admin' && (
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--gold-light)] text-[var(--gold-primary)] border border-[var(--border-gold)]"
                >
                  <Shield size={13} /> {t('nav_admin')}
                </Link>
              )}
            </>
          )}
        </nav>

        {/* Right Controls: Language Switcher, Dark/Light Switch, Auth */}
        <div className="flex items-center gap-3">
          {/* Language Switcher Button */}
          <button
            onClick={switchLanguage}
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--gold-secondary)] hover:text-[var(--gold-primary)] bg-[var(--bg-surface)] transition-all cursor-pointer"
            title={language === 'vi' ? 'Switch to English' : 'Đổi sang Tiếng Việt'}
            aria-label="Chuyển đổi ngôn ngữ"
          >
            <Globe size={14} className="text-[var(--gold-primary)]" />
            <span>{language.toUpperCase()}</span>
          </button>

          {/* Theme Dark / Light Toggle */}
          <button
            onClick={toggleTheme}
            type="button"
            className="p-2 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--gold-secondary)] hover:text-[var(--gold-primary)] bg-[var(--bg-surface)] transition-all cursor-pointer focus:outline-none"
            title={theme === 'dark' ? t('theme_light') : t('theme_dark')}
            aria-label="Chuyển đổi chế độ sáng tối"
          >
            {theme === 'dark' ? (
              <Sun size={17} className="text-amber-400 hover:rotate-45 transition-transform" />
            ) : (
              <Moon size={17} className="text-[var(--gold-primary)] hover:-rotate-12 transition-transform" />
            )}
          </button>

          {/* User Auth state */}
          {ready && user ? (
            <div className="flex items-center gap-2.5 pl-2 border-l border-[var(--border-subtle)]">
              <span className="hidden lg:inline text-xs text-[var(--text-muted)]">
                {t('nav_greeting')}, <strong className="text-[var(--text-primary)]">{user.full_name.split(' ')[0]}</strong>
              </span>
              <button
                onClick={() => void signOut()}
                disabled={loggingOut}
                type="button"
                className="text-xs font-medium text-[var(--text-secondary)] hover:text-red-500 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 cursor-pointer"
              >
                {loggingOut ? 'Đang đăng xuất…' : t('nav_logout')}
              </button>
            </div>
          ) : ready ? (
            <div className="flex items-center gap-2 pl-2 border-l border-[var(--border-subtle)]">
              <Link
                href="/login"
                className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--gold-primary)] px-3 py-2 transition-colors"
              >
                {t('nav_login')}
              </Link>
              <Link
                href="/register"
                className="hidden sm:inline-flex items-center justify-center text-xs font-semibold px-4 py-2 rounded-full bg-gradient-to-r from-[var(--gold-primary)] to-[var(--gold-secondary)] text-white shadow-sm hover:shadow-md hover:brightness-105 transition-all"
              >
                {t('nav_register')}
              </Link>
            </div>
          ) : null}
        </div>
      </div>
      {logoutError && <p role="alert" className="mx-auto max-w-7xl px-5 pb-3 text-sm text-rose-600">{logoutError}</p>}
    </header>
  );
}
