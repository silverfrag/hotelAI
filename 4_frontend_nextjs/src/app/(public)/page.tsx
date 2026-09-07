import HomeView from '@/components/features/figma/HomeView';
import { rooms } from '@/data/figma-mock';
import { getHotelBusinessDate } from '@/utils/businessDate';

export const metadata = {
  title: 'Aurum | Where Luxury Meets Horizon',
  description: 'Explore refined rooms and plan your next stay with HotelAI.',
};

export default function HomePage() {
  return <HomeView rooms={rooms} businessDate={getHotelBusinessDate()} />;
}
