import { RoomType } from '@/types/room.type';

const apiUrl = process.env.BACKEND_API_URL
  ?? process.env.NEXT_PUBLIC_API_URL
  ?? 'http://localhost:3000/api/v1/core';

export async function getRoomTypes(): Promise<RoomType[]> {
  const response = await fetch(`${apiUrl}/rooms`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Không thể tải danh sách phòng.');
  const payload = await response.json() as { data: RoomType[] };
  return payload.data;
}
