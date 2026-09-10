import HomeView from '@/components/features/figma/HomeView';
import { getRoomTypes } from '@/services/room.service';
import { mapApiRoomToPresentation } from '@/services/room-presentation';
import { getHotelBusinessDate } from '@/utils/businessDate';

export const metadata = {
  title: 'Hotel AI | Where Luxury Meets Intelligent Pricing',
  description: 'Explore refined rooms and plan your next stay with HotelAI.',
};

export default async function HomePage() {
  const rooms = (await getRoomTypes()).map(mapApiRoomToPresentation);
  return <HomeView rooms={rooms} businessDate={getHotelBusinessDate()} />;
}
