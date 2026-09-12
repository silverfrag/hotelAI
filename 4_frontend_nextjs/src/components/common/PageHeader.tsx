import type { ReactNode } from 'react';
import { cn } from '@/components/ui/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

/**
 * Reusable page-header pattern: title + optional description on the left,
 * optional action controls on the right. Reused across admin screens.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-8 flex flex-col gap-4 border-b border-white/[0.08] pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl text-balance">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-slate-400 max-w-2xl text-pretty leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

