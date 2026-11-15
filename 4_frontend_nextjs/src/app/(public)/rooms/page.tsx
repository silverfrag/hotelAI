import RoomsView from '@/components/features/figma/RoomsView';
import { getRoomTypes } from '@/services/room.service';
import { mapApiRoomToPresentation } from '@/services/room-presentation';
import { connection } from 'next/server';
import type { RoomPresentation } from '@/types/room-presentation.type';
import { getHotelBusinessDate } from '@/utils/businessDate';
export const metadata = { title: 'Hạng phòng White Sand | White Sand Boutique Hotel Đà Nẵng' };
export default async function RoomsPage() {
  await connection();
  let rooms: RoomPresentation[] = [];
  let catalogError = false;
  try {
    const data = await getRoomTypes();
    rooms = data.map(mapApiRoomToPresentation);
  } catch {
    catalogError = true;
  }
  return <RoomsView rooms={rooms} catalogError={catalogError} businessDate={getHotelBusinessDate()} />;
}
