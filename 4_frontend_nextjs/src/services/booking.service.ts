import { apiBaseUrl } from '@/services/axiosClient';
import { BookingSummary } from '@/types/booking.type';
import { BookingResult } from '@/types/room.type';

export interface CreateBookingInput {
  room_type_id: number;
  check_in_date: string;
  check_out_date: string;
  total_of_special_requests: number;
}

interface ApiResponse<T> {
  data?: T;
  message?: string | string[];
  error?: string;
}

export class BookingServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'BookingServiceError';
  }
}

function getErrorMessage<T>(payload: ApiResponse<T> | null, fallback: string): string {
  if (Array.isArray(payload?.message)) return payload.message.join(' ');
  return payload?.message ?? payload?.error ?? fallback;
}

async function readPayload<T>(response: Response): Promise<ApiResponse<T> | null> {
  return response.json().catch(() => null) as Promise<ApiResponse<T> | null>;
}

export async function createBooking(
  input: CreateBookingInput,
  accessToken: string,
): Promise<BookingResult> {
  const response = await fetch(`${apiBaseUrl}/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  const payload = await readPayload<BookingResult>(response);

  if (!response.ok || !payload?.data) {
    throw new BookingServiceError(
      getErrorMessage(payload, 'Không thể tạo đặt phòng.'),
      response.status,
    );
  }

  return payload.data;
}

export async function getBookings(
  accessToken: string,
  signal?: AbortSignal,
): Promise<BookingSummary[]> {
  const response = await fetch(`${apiBaseUrl}/bookings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal,
  });
  const payload = await readPayload<BookingSummary[]>(response);

  if (!response.ok || !Array.isArray(payload?.data)) {
    throw new BookingServiceError(
      getErrorMessage(payload, 'Không thể tải lịch sử đặt phòng.'),
      response.status,
    );
  }

  return payload.data;
}

export async function cancelBooking(
  bookingId: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/bookings/${encodeURIComponent(bookingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await readPayload<unknown>(response);

  if (!response.ok) {
    throw new BookingServiceError(
      getErrorMessage(payload, 'Không thể hủy đặt phòng.'),
      response.status,
    );
  }
}
