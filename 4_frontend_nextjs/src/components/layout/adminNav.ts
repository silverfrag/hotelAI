import type { LucideIcon } from 'lucide-react';
import { BedDouble, CalendarCheck2, HandCoins, LayoutDashboard, LineChart, Sparkles, UsersRound } from 'lucide-react';

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

export const adminNav: AdminNavSection[] = [
  {
    heading: 'Tổng quan',
    items: [{ label: 'Dashboard', href: '/admin', icon: LayoutDashboard }],
  },
  {
    heading: 'Vận hành',
    items: [
      { label: 'Bookings', href: '/admin/bookings', icon: CalendarCheck2 },
      { label: 'Thanh toán', href: '/admin/payments', icon: HandCoins },
      { label: 'Phòng', href: '/admin/rooms', icon: BedDouble },
      { label: 'Buồng phòng & AI', href: '/admin/housekeeping', icon: Sparkles, badge: 'AI' },
      { label: 'Người dùng', href: '/admin/users', icon: UsersRound },
    ],
  },
  {
    heading: 'Định giá',
    items: [{ label: 'AI Pricing', href: '/admin/pricing', icon: LineChart }],
  },
];
