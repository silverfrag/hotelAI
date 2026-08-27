import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  CalendarCheck,
  BedDouble,
  Users,
  ClipboardList,
  LineChart,
  Sparkles,
  FileBarChart,
  Settings,
} from 'lucide-react';

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Optional short badge shown on the right of the nav item. */
  badge?: string;
}

export interface AdminNavSection {
  heading: string;
  items: AdminNavItem[];
}

/**
 * Sidebar navigation model for the hotel operations console.
 * Routes are declared up-front so future feature pages can slot in
 * without changing the shell. Only Dashboard exists as a page today.
 */
export const adminNav: AdminNavSection[] = [
  {
    heading: 'Overview',
    items: [{ label: 'Dashboard', href: '/admin', icon: LayoutDashboard }],
  },
  {
    heading: 'Operations',
    items: [
      { label: 'Reservations', href: '/admin/reservations', icon: CalendarCheck },
      { label: 'Rooms', href: '/admin/rooms', icon: BedDouble },
      { label: 'Guests', href: '/admin/guests', icon: Users },
      { label: 'Operations', href: '/admin/operations', icon: ClipboardList },
    ],
  },
  {
    heading: 'Revenue',
    items: [
      { label: 'Pricing & Revenue', href: '/admin/pricing', icon: LineChart },
      { label: 'AI Optimization', href: '/admin/ai-optimization', icon: Sparkles, badge: 'Beta' },
      { label: 'Reports', href: '/admin/reports', icon: FileBarChart },
    ],
  },
  {
    heading: 'System',
    items: [{ label: 'Settings', href: '/admin/settings', icon: Settings }],
  },
];
