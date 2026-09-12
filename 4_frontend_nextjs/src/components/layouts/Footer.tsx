'use client';

import Link from 'next/link';
import { BrainCircuit, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="w-full border-t border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] transition-colors pt-16 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Brand & Multi-column Links */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 mb-16">
          {/* Brand Story */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--gold-primary)] flex items-center justify-center text-white font-serif font-bold text-lg shadow-sm">
                H
              </div>
              <span className="font-serif text-2xl font-bold text-[var(--text-primary)]">
                Hotel <span className="text-[var(--gold-primary)]">AI</span>
              </span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-sm">
              {t('footer_tagline')}
            </p>
            <div className="flex items-center gap-4 pt-2 text-xs text-[var(--text-muted)] font-medium">
              <span className="inline-flex items-center gap-1.5 text-[var(--gold-primary)]">
                <ShieldCheck size={16} /> {t('hero_badge_no_overbooking')}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[var(--gold-primary)]">
                <BrainCircuit size={16} /> Dynamic RMS 2.0
              </span>
            </div>
          </div>

          {/* Column 1: Collection */}
          <div>
            <h4 className="font-serif text-base font-bold text-[var(--text-primary)] mb-4">
              {t('footer_links_explore')}
            </h4>
            <ul className="space-y-2.5 text-sm text-[var(--text-secondary)]">
              <li>
                <Link href="/rooms" className="hover:text-[var(--gold-primary)] transition-colors">
                  {t('nav_rooms')}
                </Link>
              </li>
              <li>
                <Link href="/checkout" className="hover:text-[var(--gold-primary)] transition-colors">
                  {t('nav_quote')}
                </Link>
              </li>
              <li>
                <Link href="/bookings" className="hover:text-[var(--gold-primary)] transition-colors">
                  {t('nav_my_bookings')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 2: Account & Support */}
          <div>
            <h4 className="font-serif text-base font-bold text-[var(--text-primary)] mb-4">
              {t('footer_links_support')}
            </h4>
            <ul className="space-y-2.5 text-sm text-[var(--text-secondary)]">
              <li>
                <Link href="/login" className="hover:text-[var(--gold-primary)] transition-colors">Đăng nhập</Link>
              </li>
              <li>
                <Link href="/register" className="hover:text-[var(--gold-primary)] transition-colors">Đăng ký</Link>
              </li>
              <li>
                <Link href="/profile" className="hover:text-[var(--gold-primary)] transition-colors">Hồ sơ cá nhân</Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Legal */}
          <div>
            <h4 className="font-serif text-base font-bold text-[var(--text-primary)] mb-4">
              {t('footer_links_legal')}
            </h4>
            <ul className="space-y-2.5 text-sm text-[var(--text-secondary)]">
              <li>
                <span className="hover:text-[var(--gold-primary)] transition-colors cursor-pointer">
                  {t('footer_privacy')}
                </span>
              </li>
              <li>
                <span className="hover:text-[var(--gold-primary)] transition-colors cursor-pointer">
                  {t('footer_terms')}
                </span>
              </li>
              <li>
                <span className="hover:text-[var(--gold-primary)] transition-colors cursor-pointer">
                  Quote Lineage Audit
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Sub-bar */}
        <div className="pt-8 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--text-muted)]">
          <p>{t('footer_copyright')}</p>
          <div className="flex items-center gap-2">
            <span>Crafted with algorithmic precision & luxury aesthetics</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
