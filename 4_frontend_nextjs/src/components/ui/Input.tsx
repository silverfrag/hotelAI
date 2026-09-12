import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from './utils';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-10 w-full rounded-xl border border-[rgba(196,153,90,0.2)] bg-[#140f0a]/90 px-3.5 py-2 text-sm text-[#f0e8db] shadow-sm transition-all',
          'placeholder:text-[#8e775a]',
          'focus-visible:outline-none focus-visible:border-[#c4995a] focus-visible:ring-2 focus-visible:ring-[#c4995a]/25',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

