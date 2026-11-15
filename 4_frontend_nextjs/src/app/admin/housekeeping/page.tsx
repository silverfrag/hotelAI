import { HousekeepingOperationsManager } from '@/components/features/admin/HousekeepingOperationsManager';

export const metadata = { title: 'Buồng phòng & AI Nâng Hạng — Hotel AI Console' };

interface AdminHousekeepingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminHousekeepingPage({ searchParams }: AdminHousekeepingPageProps) {
  const params = await searchParams;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab = rawTab === 'ai-upgrades' ? 'ai-upgrades' : 'housekeeping';

  return <HousekeepingOperationsManager initialTab={initialTab} />;
}
