import RoomsView from '@/components/features/figma/RoomsView';
import { getRoomTypes } from '@/services/room.service';
import { mapApiRoomToPresentation } from '@/services/room-presentation';
import { getHotelBusinessDate } from '@/utils/businessDate';
export const metadata = { title: 'Refined Spaces | Aurum' };
export default async function RoomsPage() {
  const rooms = (await getRoomTypes()).map(mapApiRoomToPresentation);
  return <RoomsView rooms={rooms} businessDate={getHotelBusinessDate()} />;
}
