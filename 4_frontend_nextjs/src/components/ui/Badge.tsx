import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export type BadgeVariant =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

const variants: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-800/80 text-slate-300 border border-slate-700/60',
  primary: 'bg-amber-500/10 text-amber-400 border border-amber-500/25 font-semibold',
  success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  danger: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
  info: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
  outline: 'bg-slate-900/60 border border-white/10 text-slate-300',
};

const dotColors: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-400',
  primary: 'bg-amber-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400',
  info: 'bg-sky-400',
  outline: 'bg-slate-400',
};

export function Badge({ className, variant = 'neutral', dot = false, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs tracking-wide whitespace-nowrap transition-colors',
        variants[variant],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('size-1.5 rounded-full shrink-0', dotColors[variant])} aria-hidden="true" />}
      {children}
    </span>
  );
}

