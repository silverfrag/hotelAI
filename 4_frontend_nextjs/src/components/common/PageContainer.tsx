import type { HTMLAttributes } from 'react';
import { cn } from '@/components/ui/utils';

/**
 * Consistent content wrapper for every admin screen.
 * Provides the standard max-width, horizontal centering, and page padding
 * so future feature pages stay visually aligned.
 */
export function PageContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8', className)}
      {...props}
    />
  );
}
