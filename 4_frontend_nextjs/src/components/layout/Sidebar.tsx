'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Hotel, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
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
          className="fixed inset-0 z-30 bg-foreground/40 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-sidebar-foreground',
          'border-r border-sidebar-border transition-[width,transform] duration-200 ease-out',
          collapsed ? 'md:w-[72px]' : 'md:w-64',
          'w-64 md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-active text-sidebar-active-foreground">
            <Hotel className="size-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Hotel AI</p>
              <p className="truncate text-xs text-sidebar-heading">Operations Console</p>
            </div>
          )}
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="ml-auto rounded-md p-1.5 text-sidebar-item hover:bg-sidebar-hover md:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {adminNav.map((section) => (
            <div key={section.heading} className="mb-5 last:mb-0">
              {!collapsed && (
                <p className="px-3 pb-2 text-[0.68rem] font-semibold uppercase tracking-wider text-sidebar-heading">
                  {section.heading}
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
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
                          'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          collapsed && 'md:justify-center md:px-0',
                          active
                            ? 'bg-sidebar-active text-sidebar-active-foreground'
                            : 'text-sidebar-item hover:bg-sidebar-hover hover:text-white',
                        )}
                      >
                        <Icon className="size-[18px] shrink-0" />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {!collapsed && item.badge && (
                          <span className="rounded bg-sidebar-hover px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-sidebar-item">
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

        {/* Collapse toggle (desktop only) */}
        <div className="hidden border-t border-sidebar-border p-3 md:block">
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-item transition-colors hover:bg-sidebar-hover hover:text-white',
              collapsed && 'justify-center px-0',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
