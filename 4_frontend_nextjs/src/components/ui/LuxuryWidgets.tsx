'use client';

import React, { useEffect, useState } from 'react';
import { Clock, ShieldCheck, Sparkles, Star, Users } from 'lucide-react';

interface QuoteCountdownProps {
  expiresAt: string | null;
  onExpired?: () => void;
  label?: string;
}

export function QuoteCountdownTimer({ expiresAt, onExpired, label = 'Bảo đảm giá trong' }: QuoteCountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(0);
      return;
    }

    function calculate() {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt!).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && onExpired) {
        onExpired();
      }
    }

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  if (!expiresAt || secondsLeft <= 0) {
    return null;
  }

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const isUrgent = secondsLeft < 120;

  return (
    <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold tracking-wide transition-all ${
      isUrgent
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 animate-pulse'
        : 'border-[var(--gold-primary)]/30 bg-[var(--gold-light)] text-[var(--gold-primary)]'
    }`}>
      <Clock size={14} className="animate-spin" style={{ animationDuration: '6s' }} />
      <span>{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{timeFormatted}</span>
    </div>
  );
}

interface StatBadgeProps {
  icon: 'star' | 'shield' | 'sparkles' | 'users';
  title: string;
  subtitle: string;
}

export function LuxuryStatBadge({ icon, title, subtitle }: StatBadgeProps) {
  const IconComponent = {
    star: Star,
    shield: ShieldCheck,
    sparkles: Sparkles,
    users: Users,
  }[icon];

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--bg-glass-card)] border border-[var(--border-glass)] backdrop-blur-xl shadow-lg transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--gold-light)] text-[var(--gold-primary)]">
        <IconComponent size={20} />
      </div>
      <div>
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-semibold">{subtitle}</p>
        <h4 className="text-sm font-bold text-[var(--text-primary)]">{title}</h4>
      </div>
    </div>
  );
}

export function QuoteBubble({ text, author }: { text: string; author?: string }) {
  return (
    <div className="relative p-5 rounded-3xl bg-[var(--bg-glass-card)] border border-[var(--border-gold)] backdrop-blur-md shadow-lg max-w-sm">
      <div className="absolute -top-3 left-6 px-2.5 py-0.5 rounded-full bg-[var(--gold-primary)] text-white text-[10px] font-bold uppercase tracking-wider">
        Architecture & Sense
      </div>
      <p className="text-xs sm:text-sm text-[var(--text-secondary)] italic leading-relaxed pt-1">
        &ldquo;{text}&rdquo;
      </p>
      {author && (
        <p className="text-[11px] text-[var(--text-muted)] font-semibold mt-2 text-right">
          — {author}
        </p>
      )}
    </div>
  );
}

