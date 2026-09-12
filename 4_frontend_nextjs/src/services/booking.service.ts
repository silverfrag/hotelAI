import { apiBaseUrl } from '@/services/axiosClient';
import {
  CoreApiError,
  CoreApiErrorMetadata,
  CoreApiSuccessMetadata,
  invalidCoreResponseError,
  parseCoreResponse,
} from '@/services/core-api';
import { BookingPaymentSummary, BookingSummary } from '@/types/booking.type';
import {
  BookingResult,
  PriceQuote,
  QuoteClientEvent,
  QuoteEventResult,
  QuoteTrackingContext,
} from '@/types/room.type';

export interface PriceQuoteInput {
  room_type_id: number;
  check_in_date: string;
  check_out_date: string;
  total_of_special_requests: number;
  guest_count: number;
}

export interface CreateBookingInput extends PriceQuoteInput {
  quote_id: string;
  rooms?: { room_type_id: number; guest_count: number; quote_id?: string }[];
}

interface ApiResponse<T> extends CoreApiSuccessMetadata {
  data?: T;
  message?: string | string[];
}

export class BookingServiceError extends CoreApiError {
  constructor(message: string, status: number, metadata: CoreApiErrorMetadata = {}) {
    super(message, status, metadata);
    this.name = 'BookingServiceError';
  }
}

const createBookingError = (
  message: string,
  status: number,
  metadata: CoreApiErrorMetadata,
) => new BookingServiceError(message, status, metadata);

const bookingStatuses = new Set(['Pending', 'Confirmed', 'CheckedIn', 'Completed', 'Canceled', 'Expired', 'NoShow']);
const paymentStatuses = new Set(['Unpaid', 'PartiallyPaid', 'Paid', 'RefundPending', 'PartiallyRefunded', 'Refunded']);
const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isCount = (value: unknown): value is number => isAmount(value) && Number.isSafeInteger(value);
const isVersion = (value: unknown): value is number => isCount(value) && value > 0;
function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isTimestamp = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && isDateOnly(value.slice(0, 10)) && Number.isFinite(Date.parse(value));

function stayNights(checkIn: string, checkOut: string): number {
  if (!isDateOnly(checkIn) || !isDateOnly(checkOut)) return 0;
  return (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000;
}

function validQuote(value: unknown, input: PriceQuoteInput): value is PriceQuote {
  if (!isRecord(value) || !isRecord(value.room_type)) return false;
  const room = value.room_type;
  const nights = stayNights(input.check_in_date, input.check_out_date);
  return nights > 0 && isUuid(value.quote_id)
    && room.type_id === input.room_type_id && isVersion(room.type_id)
    && isText(room.type_name) && isAmount(room.base_price) && isVersion(room.capacity)
    && room.capacity >= input.guest_count
    && value.check_in_date === input.check_in_date && value.check_out_date === input.check_out_date
    && value.guest_count === input.guest_count && isVersion(value.guest_count) && value.nights === nights
    && isCount(value.rooms_available) && isCount(value.rooms_sellable) && isCount(value.rooms_booked)
    && isAmount(value.occupancy_ratio) && value.occupancy_ratio <= 1
    && isAmount(value.nightly_price) && isAmount(value.total_price)
    && isAmount(value.ai_multiplier) && value.ai_multiplier > 0
    && (value.pricing_source === 'ai' || value.pricing_source === 'base') && isVersion(value.settings_version)
    && value.currency === 'VND' && value.is_estimate === true && value.availability_is_guaranteed === false
    && isTimestamp(value.inventory_snapshot_at) && isTimestamp(value.created_at)
    && isTimestamp(value.expires_at) && isTimestamp(value.price_guaranteed_until)
    && Date.parse(value.expires_at) > Date.parse(value.created_at)
    && Date.parse(value.price_guaranteed_until) > Date.parse(value.created_at)
    && Date.parse(value.price_guaranteed_until) <= Date.parse(value.expires_at);
}

function validBookingResult(value: unknown, input: CreateBookingInput): value is BookingResult {
  if (!isRecord(value) || !isRecord(value.booking)) return false;
  const booking = value.booking;
  const nights = stayNights(input.check_in_date, input.check_out_date);
  return nights > 0 && value.quote_id === input.quote_id && isUuid(value.quote_id)
    && isUuid(booking.booking_id) && typeof booking.status === 'string' && bookingStatuses.has(booking.status)
    && booking.check_in_date === input.check_in_date && booking.check_out_date === input.check_out_date
    && booking.guest_count === input.guest_count && isVersion(booking.guest_count)
    && isVersion(booking.lifecycle_version) && (booking.policy_version === null || isVersion(booking.policy_version))
    && isAmount(booking.deposit_required) && typeof booking.checkout_payment_required === 'boolean'
    && (booking.pending_expires_at === null || isTimestamp(booking.pending_expires_at))
    && (booking.status !== 'Pending' || isTimestamp(booking.pending_expires_at))
    && isVersion(value.room_id) && isText(value.room_number) && value.nights === nights
    && isAmount(value.applied_price) && isAmount(value.nightly_price) && isAmount(value.total_price)
    && isAmount(value.ai_multiplier) && value.ai_multiplier > 0
    && (value.pricing_source === 'ai' || value.pricing_source === 'base') && isVersion(value.settings_version)
    && typeof value.payment_status === 'string' && paymentStatuses.has(value.payment_status)
    && isAmount(value.paid_amount) && isAmount(value.balance_due);
}

function validQuoteEvent(value: unknown, quoteId: string, eventType: QuoteClientEvent): value is QuoteEventResult {
  return isRecord(value) && isUuid(value.quote_event_id)
    && value.quote_id === quoteId && value.event_type === eventType
    && isTimestamp(value.occurred_at) && typeof value.replayed === 'boolean';
}

export async function createBooking(
  input: CreateBookingInput,
  _sessionMarker: string,
  idempotencyKey: string,
): Promise<BookingResult> {
  const response = await fetch(`${apiBaseUrl}/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const payload = await parseCoreResponse<ApiResponse<BookingResult>>(response, {
    fallbackMessage: 'Không thể tạo đặt phòng.',
    createError: createBookingError,
  });

  if (payload?.status !== 'success' || !validBookingResult(payload.data, input)) {
    throw invalidCoreResponseError(
      response,
      'Máy chủ chưa trả về kết quả đặt phòng hợp lệ. Vui lòng thử lại cùng yêu cầu hoặc kiểm tra lịch sử booking.',
      payload,
      createBookingError,
    );
  }

  return payload.data;
}

export async function getPriceQuote(
  input: PriceQuoteInput,
  signal?: AbortSignal,
): Promise<PriceQuote> {
  const response = await fetch(`${apiBaseUrl}/pricing/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
    signal,
  });
  const payload = await parseCoreResponse<ApiResponse<PriceQuote>>(response, {
    fallbackMessage: 'Không thể tạo báo giá vào lúc này.',
    createError: createBookingError,
  });

  if (payload?.status !== 'success' || !validQuote(payload.data, input)) {
    throw invalidCoreResponseError(
      response,
      'Máy chủ trả về báo giá không hợp lệ. Vui lòng lấy lại báo giá.',
      payload,
      createBookingError,
    );
  }

  return payload.data;
}

export async function recordQuoteEvent(
  quoteId: string,
  eventType: QuoteClientEvent,
  context: QuoteTrackingContext,
): Promise<QuoteEventResult> {
  const response = await fetch(
    `${apiBaseUrl}/pricing/quotes/${encodeURIComponent(quoteId)}/events`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `quote-event:${eventType}:${quoteId}`,
      },
      body: JSON.stringify({ event_type: eventType, ...context }),
      cache: 'no-store',
    },
  );
  const payload = await parseCoreResponse<ApiResponse<QuoteEventResult>>(response, {
    fallbackMessage: 'Không thể ghi nhận trạng thái báo giá.',
    createError: createBookingError,
  });

  if (payload?.status !== 'success' || !validQuoteEvent(payload.data, quoteId, eventType)) {
    throw invalidCoreResponseError(
      response,
      'Không thể ghi nhận trạng thái báo giá.',
      payload,
      createBookingError,
    );
  }

  return payload.data;
}

export async function getBookings(
  _sessionMarker: string,
  signal?: AbortSignal,
): Promise<BookingSummary[]> {
  const response = await fetch(`${apiBaseUrl}/bookings`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  const payload = await parseCoreResponse<ApiResponse<BookingSummary[]>>(response, {
    fallbackMessage: 'Không thể tải lịch sử đặt phòng.',
    createError: createBookingError,
  });

  if (!Array.isArray(payload?.data)) {
    throw invalidCoreResponseError(
      response,
      'Không thể tải lịch sử đặt phòng.',
      payload,
      createBookingError,
    );
  }

  return payload.data;
}

export async function getBookingPayment(
  bookingId: string,
  _sessionMarker: string,
  signal?: AbortSignal,
): Promise<BookingPaymentSummary> {
  const response = await fetch(
    `${apiBaseUrl}/bookings/${encodeURIComponent(bookingId)}/payment`,
    {
      credentials: 'include',
      cache: 'no-store',
      signal,
    },
  );
  const payload = await parseCoreResponse<ApiResponse<BookingPaymentSummary>>(response, {
    fallbackMessage: 'Không thể tải lịch sử thanh toán.',
    createError: createBookingError,
  });

  if (!payload?.data) {
    throw invalidCoreResponseError(
      response,
      'Không thể tải lịch sử thanh toán.',
      payload,
      createBookingError,
    );
  }

  return payload.data;
}

export async function cancelBooking(
  bookingId: string,
  _sessionMarker: string,
): Promise<BookingSummary> {
  const response = await fetch(`${apiBaseUrl}/bookings/${encodeURIComponent(bookingId)}/cancel`, {
    method: 'PATCH',
    credentials: 'include',
  });
  const payload = await parseCoreResponse<ApiResponse<BookingSummary>>(response, {
    fallbackMessage: 'Không thể hủy đặt phòng.',
    createError: createBookingError,
  });
  if (!payload?.data) {
    throw invalidCoreResponseError(response, 'Máy chủ chưa trả về trạng thái booking sau khi hủy.', payload, createBookingError);
  }
  return payload.data;
}

export async function getCalendarPricing(
  room_type_id: number,
  start_date: string,
  end_date: string,
  signal?: AbortSignal,
): Promise<Array<{ date: string; nightly_price: number; available: number }>> {
  const url = new URL(`${apiBaseUrl}/pricing/calendar`);
  url.searchParams.set('room_type_id', String(room_type_id));
  url.searchParams.set('start_date', start_date);
  url.searchParams.set('end_date', end_date);
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    signal,
  });
  const payload = await parseCoreResponse<ApiResponse<Array<{ date: string; nightly_price: number; available: number }>>>(response, {
    fallbackMessage: 'Không thể lấy giá lịch.',
    createError: createBookingError,
  });

  if (payload?.status !== 'success' || !Array.isArray(payload.data)) {
    throw invalidCoreResponseError(
      response,
      'Máy chủ trả về kết quả không hợp lệ.',
      payload,
      createBookingError,
    );
  }

  return payload.data;
}
