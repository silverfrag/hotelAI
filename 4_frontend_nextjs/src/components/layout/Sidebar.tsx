'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Hotel, PanelLeftClose, PanelLeftOpen, Sparkles, X } from 'lucide-react';
import { adminNav } from './adminNav';
import { cn } from '@/components/ui/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname() ?? '';

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-[#0d1117] text-slate-300',
          'border-r border-white/[0.08] transition-[width,transform] duration-200 ease-out',
          'shadow-[4px_0_24px_rgba(0,0,0,0.4)]',
          collapsed ? 'md:w-[76px]' : 'md:w-64',
          'w-64 md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.08] px-4">
          <Link
            href="/admin"
            className="flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-lg p-1 transition-transform active:scale-95"
          >
            <div className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400 shadow-sm">
              <Hotel className="size-4.5" />
              <div className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-[#0d1117]" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-bold tracking-tight text-sm text-white">HOTEL AI</p>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider text-amber-300 border border-amber-500/30">
                    CONSOLE
                  </span>
                </div>
                <p className="truncate text-[11px] font-medium tracking-wide text-slate-400">Operations Control</p>
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {adminNav.map((section) => (
            <div key={section.heading} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {section.heading}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onMobileClose}
                        title={collapsed ? item.label : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'relative group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                          collapsed && 'md:justify-center md:px-0',
                          active
                            ? 'bg-amber-500/10 text-amber-300 font-semibold border border-amber-500/20 shadow-sm'
                            : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 border border-transparent',
                        )}
                      >
                        {active && (
                          <span
                            className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-amber-500"
                            aria-hidden="true"
                          />
                        )}
                        <Icon
                          className={cn(
                            'size-[18px] shrink-0 transition-transform duration-150',
                            active ? 'text-amber-400' : 'text-slate-400 group-hover:text-slate-200',
                          )}
                        />
                        {!collapsed && (
                          <span className={cn('flex-1 truncate', active && 'font-semibold text-slate-100')}>{item.label}</span>
                        )}
                        {!collapsed && item.badge && (
                          <span className="rounded-full bg-slate-800 border border-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Pricing information; connection status is fetched on the pricing page. */}
        {!collapsed && (
          <div className="mx-3 mb-3 p-3 rounded-xl bg-slate-900/60 border border-white/[0.06] text-xs">
            <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
              <Sparkles className="size-3.5" aria-hidden="true" />
              <span className="text-[11px] tracking-wide uppercase font-bold text-slate-300">AI & Định giá</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Xem trạng thái mô hình tại Định giá & Doanh thu.
            </p>
          </div>
        )}

        {/* Collapse toggle (desktop only) */}
        <div className="hidden border-t border-white/[0.08] p-3 md:block">
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200',
              collapsed && 'justify-center px-0',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            {!collapsed && <span className="text-xs uppercase tracking-wider font-semibold">Thu gọn menu</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

