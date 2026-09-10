import BookView from '@/components/features/figma/BookView';
import { getRoomTypes } from '@/services/room.service';
import { mapApiRoomToPresentation } from '@/services/room-presentation';
import { getHotelBusinessDate } from '@/utils/businessDate';
export const metadata = { title: 'Begin Your Journey | Aurum' };
export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [query, catalog] = await Promise.all([searchParams, getRoomTypes()]);
  const rooms = catalog.map(mapApiRoomToPresentation);
  const initial = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  return <BookView rooms={rooms} businessDate={getHotelBusinessDate()} initial={initial} />;
}
