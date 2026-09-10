import { AdminBookingsManager } from '@/components/features/admin/AdminBookingsManager';
import type { AdminBookingStatus } from '@/types/admin.type';

export const metadata = { title: 'Quản lý booking — Hotel AI' };

interface AdminBookingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const allowedStatuses = new Set<AdminBookingStatus>(['Pending', 'Confirmed', 'CheckedIn', 'Completed', 'Canceled', 'Expired', 'NoShow']);

export default async function AdminBookingsPage({ searchParams }: AdminBookingsPageProps) {
  const params = await searchParams;
  const rawSearch = Array.isArray(params.search) ? params.search[0] : params.search;
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const initialSearch = (rawSearch ?? '').trim().slice(0, 100);
  const initialStatus = rawStatus && allowedStatuses.has(rawStatus as AdminBookingStatus)
    ? rawStatus as AdminBookingStatus
    : '';

  return <AdminBookingsManager initialSearch={initialSearch} initialStatus={initialStatus} />;
}
