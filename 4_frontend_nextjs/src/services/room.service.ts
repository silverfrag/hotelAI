import {
  CoreApiSuccessMetadata,
  invalidCoreResponseError,
  parseCoreResponse,
} from '@/services/core-api';
import { RoomType } from '@/types/room.type';
import { getBackendApiUrl } from '@/services/backend-url';

const apiUrl = getBackendApiUrl();

interface DataResponse<T> extends CoreApiSuccessMetadata {
  data: T;
}

function isRoomType(value: unknown): value is RoomType {
  if (!value || typeof value !== 'object') return false;
  const room = value as Record<string, unknown>;
  return typeof room.type_id === 'number' && Number.isInteger(room.type_id) && room.type_id > 0 && room.type_id <= 2147483647
    && typeof room.type_name === 'string' && room.type_name.trim().length > 0
    && typeof room.base_price === 'number' && Number.isFinite(room.base_price) && room.base_price >= 0
    && typeof room.capacity === 'number' && Number.isInteger(room.capacity) && room.capacity > 0
    && typeof room.total_rooms === 'number' && Number.isInteger(room.total_rooms) && room.total_rooms >= 0
    && typeof room.available_now === 'number' && Number.isInteger(room.available_now)
    && room.available_now >= 0 && room.available_now <= room.total_rooms;
}

export async function getRoomTypes(): Promise<RoomType[]> {
  const response = await fetch(`${apiUrl}/rooms`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const payload = await parseCoreResponse<DataResponse<RoomType[]>>(response, {
    fallbackMessage: 'Không thể tải danh sách phòng.',
  });
  if (!payload || !Array.isArray(payload.data) || !payload.data.every(isRoomType)) {
    throw invalidCoreResponseError(
      response,
      'Máy chủ trả về danh sách phòng không hợp lệ.',
      payload,
    );
  }
  return payload.data;
}

export async function getRoomType(typeId: number): Promise<RoomType | null> {
  const response = await fetch(`${apiUrl}/rooms/${typeId}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  const payload = await parseCoreResponse<DataResponse<RoomType>>(response, {
    fallbackMessage: 'Không thể tải thông tin loại phòng.',
  });
  if (!isRoomType(payload?.data) || payload.data.type_id !== typeId) {
    throw invalidCoreResponseError(
      response,
      'Máy chủ trả về thông tin loại phòng không hợp lệ.',
      payload,
    );
  }
  return payload.data;
}
