import RoomsView from '@/components/features/figma/RoomsView';
import { rooms } from '@/data/figma-mock';
import { getHotelBusinessDate } from '@/utils/businessDate';
export const metadata = { title: 'Refined Spaces | Aurum' };
export default function RoomsPage() {
  return <RoomsView rooms={rooms} businessDate={getHotelBusinessDate()} />;
}
