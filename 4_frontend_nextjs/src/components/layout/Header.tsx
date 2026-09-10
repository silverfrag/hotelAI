'use client';

import { FormEvent, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu, Search } from 'lucide-react';
import { adminNav } from './adminNav';
import { useAuth } from '@/hooks/useAuth';
import type { User } from '@/types/user.type';

interface HeaderProps {
  onMobileOpen: () => void;
  user: User;
}

function currentPageLabel(pathname: string): string {
  const all = adminNav.flatMap((s) => s.items);
  const match = all
    .filter((i) => (i.href === '/admin' ? pathname === '/admin' : pathname.startsWith(i.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? 'Dashboard';
}

export function Header({ onMobileOpen, user }: HeaderProps) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { logout, loggingOut, logoutError } = useAuth();
  const [search, setSearch] = useState('');
  const label = currentPageLabel(pathname);
  const initials = (user?.full_name ?? 'Admin')
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = search.trim().slice(0, 100);
    router.push(normalized ? `/admin/bookings?search=${encodeURIComponent(normalized)}` : '/admin/bookings');
  }

  async function signOut() {
    try {
      await logout();
      router.replace('/login');
    } catch {
      // The shared error remains visible beside the retry action.
    }
  }

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

      <form className="relative ml-auto hidden w-full max-w-xs lg:block" role="search" onSubmit={submitSearch}>
        <label htmlFor="admin-global-search" className="sr-only">Tìm booking</label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id="admin-global-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm khách, phòng, mã booking…"
          maxLength={100}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <button
          type="submit"
          aria-label="Tìm booking"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-4" />
        </button>
      </form>

      {/* Profile */}
      <div className="ml-auto flex items-center gap-3 border-l border-border pl-3 lg:ml-0">
        <div className="hidden text-right leading-tight sm:block">
          <p className="max-w-40 truncate text-sm font-medium text-foreground">{user?.full_name ?? 'Admin'}</p>
          <p className="text-xs text-muted-foreground">Quản trị viên</p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-full bg-primary-muted text-sm font-semibold text-primary">
          {initials || 'A'}
        </div>
        <button
          type="button"
          aria-label="Đăng xuất"
          title="Đăng xuất"
          disabled={loggingOut}
          onClick={() => void signOut()}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </div>
      {logoutError && <p role="alert" className="absolute right-4 top-full mt-2 max-w-sm rounded-md border border-danger/20 bg-card px-3 py-2 text-sm text-danger shadow-sm">{logoutError}</p>}
    </header>
  );
}
