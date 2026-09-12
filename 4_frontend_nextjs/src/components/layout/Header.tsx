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
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/[0.08] bg-[#0d1117]/85 px-4 backdrop-blur-md md:px-6 shadow-sm">
      <button
        type="button"
        onClick={onMobileOpen}
        aria-label="Open navigation"
        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {/* Page context */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden text-xs font-semibold uppercase tracking-wider text-slate-400 sm:inline">Console</span>
        <span className="hidden text-slate-600 sm:inline" aria-hidden="true">
          /
        </span>
        <span className="truncate text-sm font-semibold tracking-tight text-white">{label}</span>
      </div>

      <form className="relative ml-auto hidden w-full max-w-sm lg:block" role="search" onSubmit={submitSearch}>
        <label htmlFor="admin-global-search" className="sr-only">Tìm booking</label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          id="admin-global-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm khách, phòng, mã booking…"
          maxLength={100}
          className="h-9 w-full rounded-lg border border-white/[0.08] bg-slate-900/80 pl-10 pr-12 text-sm text-slate-100 placeholder:text-slate-400 transition-all focus-visible:border-amber-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/25"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          ⌘K
        </kbd>
      </form>

      {/* Profile */}
      <div className="ml-auto flex items-center gap-3 border-l border-white/[0.08] pl-3 lg:ml-0">
        <div className="hidden text-right leading-tight sm:block">
          <p className="max-w-40 truncate text-sm font-medium text-slate-200">{user?.full_name ?? 'Admin'}</p>
          <div className="mt-0.5 flex items-center justify-end gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-medium text-slate-400">Quản trị viên</span>
          </div>
        </div>

        {/* Clean circular avatar */}
        <div className="relative flex size-8 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-bold shadow-sm">
          {initials || 'A'}
        </div>

        <button
          type="button"
          aria-label="Đăng xuất"
          title="Đăng xuất"
          disabled={loggingOut}
          onClick={() => void signOut()}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/30"
        >
          <LogOut className="size-4" />
        </button>
      </div>
      {logoutError && (
        <p role="alert" className="absolute right-4 top-full mt-2 max-w-sm rounded-lg border border-rose-500/30 bg-[#131823] px-3.5 py-2 text-sm text-rose-400 shadow-xl">
          {logoutError}
        </p>
      )}
    </header>
  );
}
