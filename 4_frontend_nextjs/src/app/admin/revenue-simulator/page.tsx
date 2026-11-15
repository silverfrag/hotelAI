import { AdminRevenueSimulator } from '@/components/features/admin/AdminRevenueSimulator';

export const metadata = {
  title: 'Revenue Simulator (P8) — HotelAI Admin',
  description: 'Mô phỏng doanh thu và tối ưu phân bổ phòng có ràng buộc bằng Google OR-Tools',
};

export default function RevenueSimulatorPage() {
  return <AdminRevenueSimulator />;
}
