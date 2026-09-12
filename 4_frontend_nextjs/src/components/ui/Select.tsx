import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './utils';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'h-10 w-full appearance-none rounded-xl border border-[rgba(196,153,90,0.2)] bg-[#140f0a]/90 pl-3.5 pr-10 text-sm text-[#f0e8db] shadow-sm transition-all',
            'focus-visible:outline-none focus-visible:border-[#c4995a] focus-visible:ring-2 focus-visible:ring-[#c4995a]/25',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[#8e775a]"
          aria-hidden="true"
        />
      </div>
    );
  },
);
Select.displayName = 'Select';

