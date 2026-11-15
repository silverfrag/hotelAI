import HomeView from '@/components/features/figma/HomeView';
import { getRoomTypes } from '@/services/room.service';
import { mapApiRoomToPresentation } from '@/services/room-presentation';
import { connection } from 'next/server';
import type { RoomPresentation } from '@/types/room-presentation.type';
import { getHotelBusinessDate } from '@/utils/businessDate';

export const metadata = {
  title: 'White Sand Boutique Hotel Đà Nẵng | Không gian lưu trú & Báo giá thông minh',
  description: 'Khám phá 6 hạng phòng, 54 phòng lưu trú tại 89-91 Võ Văn Kiệt, Sơn Trà, Đà Nẵng và trải nghiệm báo giá theo ngữ cảnh cùng HotelAI.',
};

export default async function HomePage() {
  await connection();
  let rooms: RoomPresentation[] = [];
  let catalogError = false;
  try {
    const data = await getRoomTypes();
    rooms = data.map(mapApiRoomToPresentation);
  } catch {
    catalogError = true;
  }
  return <HomeView rooms={rooms} catalogError={catalogError} businessDate={getHotelBusinessDate()} />;
}
