import { notFound } from 'next/navigation';
import RoomDetailView from '@/components/features/figma/RoomDetailView';
import { rooms } from '@/data/figma-mock';
import { getHotelBusinessDate } from '@/utils/businessDate';
export default async function RoomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = rooms.find((item) => String(item.id) === id);
  if (!room) notFound();
  return <RoomDetailView room={room} businessDate={getHotelBusinessDate()} />;
}
