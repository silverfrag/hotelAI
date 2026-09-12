import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold shadow-sm',
  secondary:
    'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-white/10 shadow-sm',
  outline:
    'border border-white/10 bg-slate-900/60 text-slate-200 hover:bg-slate-800 hover:text-white shadow-sm',
  ghost:
    'text-slate-400 hover:bg-white/5 hover:text-slate-200',
  danger:
    'bg-rose-600 hover:bg-rose-500 text-white shadow-sm font-medium',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
  md: 'h-9 px-4 text-sm [&_svg]:size-4',
  lg: 'h-11 px-6 text-sm [&_svg]:size-5',
  icon: 'h-9 w-9 [&_svg]:size-4',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

