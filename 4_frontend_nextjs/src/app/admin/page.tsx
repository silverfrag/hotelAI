import { CalendarDays, Download } from 'lucide-react';
import { PageContainer } from '@/components/common/PageContainer';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatCards } from '@/components/features/dashboard/StatCards';
import { RoomStatusPanel } from '@/components/features/dashboard/RoomStatusPanel';
import { RecentReservations } from '@/components/features/dashboard/RecentReservations';
import { AiRecommendations } from '@/components/features/dashboard/AiRecommendations';

export default function AdminDashboardPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Wednesday, August 27, 2026 · Live operational overview"
        actions={
          <>
            <Button variant="outline" size="md">
              <CalendarDays />
              Today
            </Button>
            <Button variant="primary" size="md" disabled>
              <Download />
              Export
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <StatCards />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentReservations />
          </div>
          <div className="lg:col-span-1">
            <RoomStatusPanel />
          </div>
        </div>

        <AiRecommendations />
      </div>
    </PageContainer>
  );
}
