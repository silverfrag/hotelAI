'use client';

import { usePathname } from 'next/navigation';
import { Bell, Menu, Search } from 'lucide-react';
import { adminNav } from './adminNav';

interface HeaderProps {
  onMobileOpen: () => void;
}

function currentPageLabel(pathname: string): string {
  const all = adminNav.flatMap((s) => s.items);
  const match = all
    .filter((i) => (i.href === '/admin' ? pathname === '/admin' : pathname.startsWith(i.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? 'Dashboard';
}

export function Header({ onMobileOpen }: HeaderProps) {
  const pathname = usePathname() ?? '';
  const label = currentPageLabel(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur md:px-6">
      <button
        type="button"
        onClick={onMobileOpen}
        aria-label="Open navigation"
        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {/* Page context */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden text-sm text-muted-foreground sm:inline">Console</span>
        <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
          /
        </span>
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
      </div>

      {/* Search */}
      <div className="relative ml-auto hidden w-full max-w-xs lg:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search reservations, guests, rooms..."
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>

      {/* Notifications */}
      <button
        type="button"
        aria-label="Notifications"
        className="relative ml-auto rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:ml-0"
      >
        <Bell className="size-5" />
        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-danger ring-2 ring-card" aria-hidden="true" />
      </button>

      {/* Profile */}
      <div className="flex items-center gap-3 border-l border-border pl-3">
        <div className="hidden text-right leading-tight sm:block">
          <p className="text-sm font-medium text-foreground">Front Desk</p>
          <p className="text-xs text-muted-foreground">Operations</p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-full bg-primary-muted text-sm font-semibold text-primary">
          FD
        </div>
      </div>
    </header>
  );
}
