import BookView from '@/components/features/figma/BookView';
import { rooms } from '@/data/figma-mock';
import { getHotelBusinessDate } from '@/utils/businessDate';
export const metadata = { title: 'Begin Your Journey | Aurum' };
export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const initial = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  return <BookView rooms={rooms} businessDate={getHotelBusinessDate()} initial={initial} />;
}
