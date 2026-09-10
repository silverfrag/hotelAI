import { notFound } from 'next/navigation';
import RoomDetailView from '@/components/features/figma/RoomDetailView';
import { getRoomType } from '@/services/room.service';
import { mapApiRoomToPresentation } from '@/services/room-presentation';
import { getHotelBusinessDate } from '@/utils/businessDate';
export default async function RoomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) notFound();
  const room = await getRoomType(Number(id));
  if (!room) notFound();
  return <RoomDetailView room={mapApiRoomToPresentation(room)} businessDate={getHotelBusinessDate()} />;
}
